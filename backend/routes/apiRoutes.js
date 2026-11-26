import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_BYTES, UPLOAD_DIR } from '../config.js';
import {
  getDatabase,
  getRevision,
  mutateDatabase,
  makeActivityEntry,
  replaceDatabase,
  saveDatabaseSync,
  ACTIVITY_LOG_LIMIT,
  COLLECTIONS
} from '../data/dbManager.js';
import {
  authenticate,
  clearFailedLogins,
  createToken,
  hashPassword,
  loginRateLimited,
  publicUser,
  registerFailedLogin,
  requireAdmin,
  requireAuth,
  verifyPasswordHash
} from '../auth.js';
import { applyChanges, scopeForPrincipal } from '../syncLogic.js';

const router = express.Router();

/* ============================================================
   FAYL YUKLASH SOZLAMALARI
   ============================================================ */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Taxmin qilib bo'lmaydigan nom: fayllarni begona odamlar topa olmaydi
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    // Brauzerlar ba'zan fayl nomini latin1 sifatida yuboradi — UTF-8 ga tiklaymiz
    try {
      const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (!decoded.includes('�')) file.originalname = decoded;
    } catch { /* ignore */ }
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(Object.assign(new Error(`Faqat ruxsat etilgan fayl formatlari: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}`), { status: 400 }));
  }
});

function clientKey(req, username) {
  return `${req.ip}|${String(username || '').toLowerCase()}`;
}

/* ============================================================
   1. AUTENTIFIKATSIYA
   ============================================================ */

router.post('/auth/login', (req, res) => {
  const { username, password, role } = req.body || {};
  const key = clientKey(req, username);
  if (loginRateLimited(key) || loginRateLimited(req.ip)) {
    return res.status(429).json({ success: false, message: "Juda ko'p noto'g'ri urinish. 15 daqiqadan so'ng qayta urinib ko'ring." });
  }
  const principal = authenticate(username, password, role);
  if (!principal) {
    registerFailedLogin(key);
    registerFailedLogin(req.ip);
    return res.status(401).json({
      success: false,
      message: role === 'admin' ? 'Admin logini yoki paroli noto‘g‘ri.' : 'Login yoki parol noto‘g‘ri.'
    });
  }
  clearFailedLogins(key);
  res.json({ success: true, token: createToken(principal), user: publicUser(principal) });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: publicUser(req.principal) });
});

router.post('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const next = String(newPassword || '');
  if (next.length < 6) {
    return res.status(400).json({ success: false, message: 'Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.' });
  }
  const principal = req.principal;
  const db = getDatabase();

  if (principal.role === 'admin') {
    if (!verifyPasswordHash(currentPassword, db.admin.passwordHash)) {
      return res.status(400).json({ success: false, message: 'Joriy parol noto‘g‘ri.' });
    }
    mutateDatabase((d) => {
      d.admin = { ...d.admin, passwordHash: hashPassword(next), updatedAt: new Date().toISOString() };
    });
  } else {
    if (String(currentPassword || '') !== String(principal.account.password || '')) {
      return res.status(400).json({ success: false, message: 'Joriy parol noto‘g‘ri.' });
    }
    mutateDatabase((d) => {
      d.accounts = d.accounts.map((a) => (a.username === principal.account.username ? { ...a, password: next } : a));
    });
  }
  saveDatabaseSync();

  // Yangi parol bilan yangi token (eski tokenlar avtomatik bekor bo'ladi)
  const refreshed = authenticate(principal.username, next, principal.role);
  res.json({ success: true, message: 'Parol muvaffaqiyatli yangilandi.', token: refreshed ? createToken(refreshed) : null });
});

/* ============================================================
   2. SINXRONIZATSIYA
   ============================================================ */

router.get('/sync', requireAuth, (req, res) => {
  const db = getDatabase();
  res.json({
    success: true,
    revision: db.revision,
    lastModified: db.lastModified,
    data: scopeForPrincipal(db, req.principal)
  });
});

router.get('/sync/version', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...getRevision() });
});

/**
 * POST /api/sync
 * body: { changes: { [collection]: { upsert: [...], remove: [...] } } }
 */
router.post('/sync', requireAuth, (req, res) => {
  const { changes } = req.body || {};
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return res.status(400).json({ success: false, message: "changes obyekti talab qilinadi" });
  }
  const before = getRevision().revision;
  let outcome = { applied: 0, rejected: 0 };
  const result = mutateDatabase((db) => {
    outcome = applyChanges(db, req.principal, changes);
  });
  res.json({
    success: true,
    revision: result.revision,
    previousRevision: before,
    lastModified: result.lastModified,
    ...outcome
  });
});

/* ============================================================
   3. FAYLLAR
   ============================================================ */

router.post('/upload', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Fayl hajmi ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB dan oshmasligi kerak.`
        : err.message;
      return res.status(400).json({ success: false, message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Fayl biriktirilmadi!' });
    }
    try {
      const { category } = req.body || {};
      const actor = publicUser(req.principal);
      if (category) {
        mutateDatabase((db) => {
          db.activityLog = [
            makeActivityEntry(actor.researcherName || actor.name, `${category}: fayl yukladi (${req.file.originalname})`),
            ...db.activityLog
          ].slice(0, ACTIVITY_LOG_LIMIT);
        });
      }
      res.status(201).json({
        success: true,
        message: 'Fayl serverga muvaffaqiyatli yuklandi!',
        data: {
          fileUrl: `/uploads/${req.file.filename}`,
          fileName: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
          uploadedAt: new Date().toISOString()
        }
      });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Fayl serverda topilmadi!' });
  }
  const downloadName = typeof req.query.name === 'string' ? path.basename(req.query.name) : filename;
  res.download(filePath, downloadName);
});

/* ============================================================
   4. ADMIN: ZAXIRA NUSXA
   ============================================================ */

router.get('/admin/backup', requireAdmin, (req, res) => {
  const db = getDatabase();
  const { admin: _admin, ...data } = db;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.set('Content-Disposition', `attachment; filename="ilm-baza-zaxira-${stamp}.json"`);
  res.json(data);
});

router.post('/admin/restore', requireAdmin, (req, res) => {
  const payload = req.body?.data ?? req.body;
  if (!payload || typeof payload !== 'object' || !COLLECTIONS.some((key) => Array.isArray(payload[key]))) {
    return res.status(400).json({ success: false, message: "Zaxira fayli noto'g'ri formatda." });
  }
  const result = replaceDatabase(payload);
  res.json({ success: true, message: 'Baza zaxiradan tiklandi.', ...result });
});

export default router;

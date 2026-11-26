import crypto from 'node:crypto';
import fs from 'node:fs';
import { ADMIN_CREDENTIALS_FILE, TOKEN_TTL_MS, getSessionSecret } from './config.js';
import { getDatabase, mutateDatabase, saveDatabaseSync } from './data/dbManager.js';

/* ---------------- Parol xeshlash (admin uchun) ---------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPasswordHash(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false;
  const [, salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/* ---------------- Admin hisobi ---------------- */

function writeAdminCredentialsFile(username, password) {
  try {
    fs.writeFileSync(
      ADMIN_CREDENTIALS_FILE,
      `Ilm+ administrator hisobi\nLogin: ${username}\nParol: ${password}\n\nTizimga kirgach Sozlamalar bo'limida parolni o'zgartiring va ushbu faylni o'chiring.\n`,
      { encoding: 'utf-8', mode: 0o600 }
    );
  } catch (e) {
    console.warn('[Ilm+ Auth] Admin parol faylini yozib bo\'lmadi:', e.message);
  }
}

/**
 * Admin hisobi yo'q bo'lsa yaratadi. ADMIN_USERNAME / ADMIN_PASSWORD muhit
 * o'zgaruvchilari berilmasa, tasodifiy parol yaratilib konsolga va
 * DATA_DIR/ADMIN_PAROL.txt fayliga yoziladi.
 */
export function ensureAdminAccount({ forceReset = false } = {}) {
  const db = getDatabase();
  if (db.admin && !forceReset) return null;

  const username = (process.env.ADMIN_USERNAME || db.admin?.username || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || generatePassword(12);
  const generated = !process.env.ADMIN_PASSWORD;

  mutateDatabase((d) => {
    d.admin = { username, passwordHash: hashPassword(password), updatedAt: new Date().toISOString() };
  });
  saveDatabaseSync();

  if (generated) writeAdminCredentialsFile(username, password);
  console.log('========================================================');
  console.log(' [Ilm+] Administrator hisobi yaratildi');
  console.log(`   Login: ${username}`);
  console.log(`   Parol: ${generated ? password : '(ADMIN_PASSWORD muhit o\'zgaruvchisidan olindi)'}`);
  if (generated) console.log(`   (nusxasi: ${ADMIN_CREDENTIALS_FILE})`);
  console.log('========================================================');
  return { username, password };
}

/* ---------------- Tokenlar ---------------- */

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
}

/** Parol o'zgarganda eski tokenlar bekor bo'lishi uchun "parol versiyasi". */
function passwordVersion(secretMaterial) {
  return crypto.createHash('sha256').update(`${getSessionSecret()}|${secretMaterial}`).digest('base64url').slice(0, 16);
}

export function createToken(principal) {
  const payload = {
    sub: principal.username,
    role: principal.role,
    pv: passwordVersion(principal.secretMaterial),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function findPrincipal(role, username) {
  const db = getDatabase();
  if (role === 'admin') {
    if (db.admin && db.admin.username.toLowerCase() === String(username).toLowerCase()) {
      return { role: 'admin', username: db.admin.username, secretMaterial: db.admin.passwordHash };
    }
    return null;
  }
  const account = db.accounts.find((a) => String(a.username).toLowerCase() === String(username).toLowerCase());
  if (!account) return null;
  return { role: 'researcher', username: account.username, secretMaterial: account.password || '', account };
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!payload || payload.exp < Date.now()) return null;
  const principal = findPrincipal(payload.role, payload.sub);
  if (!principal || !safeEqual(passwordVersion(principal.secretMaterial), payload.pv)) return null;
  return principal;
}

/* ---------------- Login ---------------- */

export function authenticate(username, password, roleHint) {
  const cleanUser = String(username || '').trim();
  const pass = String(password || '');
  if (!cleanUser || !pass) return null;
  const db = getDatabase();

  if (roleHint !== 'researcher' && db.admin && db.admin.username.toLowerCase() === cleanUser.toLowerCase()) {
    if (verifyPasswordHash(pass, db.admin.passwordHash)) {
      return findPrincipal('admin', db.admin.username);
    }
    return null;
  }
  if (roleHint === 'admin') return null;

  const principal = findPrincipal('researcher', cleanUser);
  if (principal && principal.account.password && safeEqual(principal.account.password, pass)) {
    return principal;
  }
  return null;
}

/** Foydalanuvchiga qaytariladigan xavfsiz profil (parolsiz). */
export function publicUser(principal) {
  if (!principal) return null;
  if (principal.role === 'admin') {
    return { role: 'admin', username: principal.username, name: 'Administrator' };
  }
  const db = getDatabase();
  const account = principal.account;
  const profile = db.researchers.find((r) => r.username === account.username)
    || db.researchers.find((r) => r.name === account.researcherName)
    || {};
  return {
    role: 'researcher',
    username: account.username,
    researcherName: account.researcherName || profile.name || account.username,
    name: account.researcherName || profile.name || account.username,
    stage: Number(account.stage || profile.stage || 1),
    field: profile.field || '',
    supervisor: profile.supervisor || '',
    department: profile.department || ''
  };
}

/* ---------------- Middleware ---------------- */

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (typeof req.query?.token === 'string') return req.query.token;
  return null;
}

export function requireAuth(req, res, next) {
  const principal = verifyToken(extractToken(req));
  if (!principal) {
    return res.status(401).json({ success: false, message: 'Avtorizatsiya talab qilinadi. Iltimos, qayta kiring.' });
  }
  req.principal = principal;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.principal.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Bu amal faqat administrator uchun.' });
    }
    next();
  });
}

/* ---------------- Login urinishlarini cheklash ---------------- */

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 10;

export function loginRateLimited(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED;
}

export function registerFailedLogin(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
  if (attempts.size > 10000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }
}

export function clearFailedLogins(key) {
  attempts.delete(key);
}

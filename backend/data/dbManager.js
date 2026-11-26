import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE, ensureDirs } from '../config.js';

/** Bazadagi barcha to'plamlar (har biri massiv). */
export const COLLECTIONS = [
  'accounts',
  'researchers',
  'expertiseCases',
  'monitoringFiles',
  'monitoringReports',
  'kengashFiles',
  'postDefenseFiles',
  'activityLog',
  'normativeDocuments'
];

export const ACTIVITY_LOG_LIMIT = 50;

let dbCache = null;
let saveTimer = null;

function emptyDatabase() {
  const db = { revision: 1, lastModified: new Date().toISOString(), admin: null };
  for (const key of COLLECTIONS) db[key] = [];
  return db;
}

/** Eski yoki qisman to'ldirilgan bazani joriy formatga keltiradi. */
export function normalizeDatabase(raw) {
  const db = { ...emptyDatabase(), ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const key of COLLECTIONS) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  if (!Number.isFinite(db.revision) || db.revision < 1) db.revision = 1;
  if (!db.lastModified) db.lastModified = new Date().toISOString();
  if (db.admin && (typeof db.admin !== 'object' || !db.admin.username || !db.admin.passwordHash)) {
    db.admin = null;
  }
  return db;
}

export function initDatabase() {
  if (dbCache) return dbCache;
  ensureDirs();

  if (fs.existsSync(DB_FILE)) {
    try {
      dbCache = normalizeDatabase(JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')));
      console.log(`[Ilm+ DB] Baza yuklandi (${DB_FILE}). Reviziya: ${dbCache.revision}`);
      return dbCache;
    } catch (e) {
      // Buzilgan faylni o'chirib yubormaslik uchun zaxira nusxasini saqlab qo'yamiz
      const brokenCopy = `${DB_FILE}.broken-${Date.now()}`;
      try { fs.copyFileSync(DB_FILE, brokenCopy); } catch { /* ignore */ }
      console.error(`[Ilm+ DB] Bazani o'qib bo'lmadi (${e.message}). Nusxa: ${brokenCopy}. Yangi bo'sh baza yaratilmoqda.`);
    }
  }

  dbCache = emptyDatabase();
  saveDatabaseSync();
  console.log(`[Ilm+ DB] Yangi bo'sh baza yaratildi: ${DB_FILE}`);
  return dbCache;
}

export function saveDatabaseSync() {
  if (!dbCache) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[Ilm+ DB] Saqlashda xatolik:', err);
  }
}

function saveDatabaseDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDatabaseSync();
  }, 200);
}

export function getDatabase() {
  return dbCache || initDatabase();
}

export function getRevision() {
  const db = getDatabase();
  return { revision: db.revision, lastModified: db.lastModified };
}

/** Bazani o'zgartiradi, reviziyani oshiradi va diskka (kechiktirib) yozadi. */
export function mutateDatabase(callback) {
  const db = getDatabase();
  callback(db);
  db.revision = (db.revision || 0) + 1;
  db.lastModified = new Date().toISOString();
  saveDatabaseDebounced();
  return { revision: db.revision, lastModified: db.lastModified };
}

/** Butun bazani almashtirish (zaxiradan tiklash). Admin hisobi saqlanib qoladi. */
export function replaceDatabase(rawData) {
  const current = getDatabase();
  const next = normalizeDatabase(rawData);
  next.admin = current.admin;
  next.revision = Math.max(current.revision, next.revision) + 1;
  next.lastModified = new Date().toISOString();
  dbCache = next;
  saveDatabaseSync();
  return { revision: next.revision, lastModified: next.lastModified };
}

export function makeActivityEntry(name, action) {
  return {
    id: `act-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: name || 'Foydalanuvchi',
    action: action || 'Harakat bajarildi',
    time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Asia/Tashkent' })
  };
}

export function addActivity(name, action) {
  mutateDatabase((db) => {
    db.activityLog = [makeActivityEntry(name, action), ...db.activityLog].slice(0, ACTIVITY_LOG_LIMIT);
  });
}

/** Jarayon to'xtatilganda kechiktirilgan yozuvlar yo'qolmasligi uchun. */
export function flushOnExit() {
  const flush = () => {
    if (saveTimer) saveDatabaseSync();
  };
  process.on('exit', flush);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      flush();
      process.exit(0);
    });
  }
}

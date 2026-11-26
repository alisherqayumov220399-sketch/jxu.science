import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ma'lumotlar papkasi. Hostingda doimiy disk (persistent disk) ulangan
 * papkani DATA_DIR orqali ko'rsating, aks holda qayta ishga tushirishda
 * ma'lumotlar yo'qolishi mumkin.
 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'uploads')
  : path.join(__dirname, 'uploads');
export const DIST_DIR = path.resolve(__dirname, '../dist');

export const ADMIN_CREDENTIALS_FILE = path.join(DATA_DIR, 'ADMIN_PAROL.txt');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.doc', '.docx', '.zip', '.xlsx', '.xls', '.jpg', '.jpeg', '.png'];

export function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

let cachedSecret = null;

/** Tokenlarni imzolash uchun maxfiy kalit (env yoki diskda saqlangan tasodifiy qiymat). */
export function getSessionSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }
  ensureDirs();
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return cachedSecret;
    }
  } catch {
    // fayl hali yo'q
  }
  cachedSecret = randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, cachedSecret, { encoding: 'utf-8', mode: 0o600 });
  return cachedSecret;
}

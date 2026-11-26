/**
 * Sinxronizatsiya mantiqi:
 *  - scopeForPrincipal: foydalanuvchiga faqat unga ruxsat etilgan ma'lumotlarni qaytaradi
 *  - applyChanges: mijoz yuborgan o'zgarishlarni (upsert/remove) rol bo'yicha tekshirib qo'llaydi
 */
import { ACTIVITY_LOG_LIMIT, COLLECTIONS } from './data/dbManager.js';

const PENDING = 'Kutilmoqda';

export function recordKey(collection, record) {
  if (!record || typeof record !== 'object') return null;
  const key = collection === 'accounts' ? record.username : record.id;
  return key === undefined || key === null || key === '' ? null : String(key);
}

/** Tadqiqotchi o'zgartira oladigan to'plamlar. */
const RESEARCHER_WRITABLE = new Set([
  'expertiseCases',
  'monitoringFiles',
  'monitoringReports',
  'kengashFiles',
  'postDefenseFiles'
]);

/** Admin ko'rib chiqadigan (holat maydoni bor) to'plamlar. */
const REVIEWED_COLLECTIONS = new Set(['monitoringReports', 'kengashFiles', 'postDefenseFiles']);
const REVIEW_FIELDS = ['status', 'rejectReason', 'rejectedAt', 'reviewedAt'];

function ownerMatches(collection, record, account) {
  if (!record) return false;
  if (record.username && record.username === account.username) return true;
  if (collection === 'expertiseCases' && !record.username) {
    return Boolean(account.researcherName) && record.researcherName === account.researcherName;
  }
  return false;
}

function stripPassword(account) {
  const { password: _password, ...rest } = account;
  return rest;
}

export function scopeForPrincipal(db, principal) {
  if (principal.role === 'admin') {
    const data = {};
    for (const key of COLLECTIONS) data[key] = db[key];
    return data;
  }
  const account = principal.account;
  const data = {
    accounts: db.accounts.filter((a) => a.username === account.username).map(stripPassword),
    researchers: db.researchers.filter((r) => r.username === account.username),
    activityLog: [],
    normativeDocuments: db.normativeDocuments
  };
  for (const key of RESEARCHER_WRITABLE) {
    data[key] = db[key].filter((record) => ownerMatches(key, record, account));
  }
  return data;
}

/** Tadqiqotchi yozuvini xavfsiz holatga keltiradi (o'z-o'zini tasdiqlashning oldini oladi). */
function sanitizeResearcherRecord(collection, incoming, existing, account) {
  if (collection === 'expertiseCases') {
    if (existing) {
      // Tadqiqotchi faqat yuklagan hujjatlar ro'yxatini o'zgartira oladi
      return { ...existing, username: existing.username || account.username, documentsStatus: incoming.documentsStatus || existing.documentsStatus || {} };
    }
    return {
      ...incoming,
      username: account.username,
      researcherName: account.researcherName || incoming.researcherName,
      status: 'docs_check',
      resolution: null
    };
  }

  const record = { ...incoming, username: account.username };
  if (REVIEWED_COLLECTIONS.has(collection) && !incoming.isApp) {
    if (existing) {
      for (const field of REVIEW_FIELDS) {
        if (field in existing) record[field] = existing[field];
        else delete record[field];
      }
    } else {
      record.status = PENDING;
      record.rejectReason = '';
      delete record.rejectedAt;
      delete record.reviewedAt;
    }
  }
  return record;
}

/**
 * changes: { [collection]: { upsert: Record[], remove: string[] } }
 * Natija: { applied, rejected }
 */
export function applyChanges(db, principal, changes) {
  let applied = 0;
  let rejected = 0;
  const isAdmin = principal.role === 'admin';
  const account = principal.account;

  for (const [collection, change] of Object.entries(changes || {})) {
    if (!COLLECTIONS.includes(collection) || !change || typeof change !== 'object') {
      rejected += 1;
      continue;
    }
    if (!isAdmin && !RESEARCHER_WRITABLE.has(collection)) {
      rejected += (change.upsert?.length || 0) + (change.remove?.length || 0);
      continue;
    }

    let list = Array.isArray(db[collection]) ? [...db[collection]] : [];
    const indexOf = (key) => list.findIndex((r) => recordKey(collection, r) === key);

    // O'chirishlar
    for (const rawKey of Array.isArray(change.remove) ? change.remove : []) {
      const key = String(rawKey);
      const idx = indexOf(key);
      if (idx < 0) continue;
      if (!isAdmin && !ownerMatches(collection, list[idx], account)) {
        rejected += 1;
        continue;
      }
      list.splice(idx, 1);
      applied += 1;
    }

    // Qo'shish / yangilash (yangi yozuvlar boshiga qo'shiladi)
    const upserts = Array.isArray(change.upsert) ? change.upsert : [];
    const newRecords = [];
    for (const incoming of upserts) {
      const key = recordKey(collection, incoming);
      if (!key) {
        rejected += 1;
        continue;
      }
      const idx = indexOf(key);
      const existing = idx >= 0 ? list[idx] : null;
      let record = incoming;

      if (!isAdmin) {
        if (existing && !ownerMatches(collection, existing, account)) {
          rejected += 1;
          continue;
        }
        record = sanitizeResearcherRecord(collection, incoming, existing, account);
      } else if (collection === 'accounts' && existing && !incoming.password) {
        // Parolsiz yangilanish parolni o'chirib yubormasligi kerak
        record = { ...incoming, password: existing.password };
      }

      if (idx >= 0) list[idx] = record;
      else newRecords.push(record);
      applied += 1;
    }
    list = [...newRecords, ...list];
    if (collection === 'activityLog') list = list.slice(0, ACTIVITY_LOG_LIMIT);
    db[collection] = list;
  }

  return { applied, rejected };
}

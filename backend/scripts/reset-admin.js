/**
 * Administrator parolini tiklash:  npm run reset-admin
 * Muhim: buyruqni server TO'XTATILGAN holatda bajaring.
 * Login: ADMIN_USERNAME (standart: OTKTF). Parol: ADMIN_PASSWORD berilsa o'sha,
 * aks holda tasodifiy parol yaratilib konsolga va ADMIN_PAROL.txt ga yoziladi.
 */
import { ensureAdminAccount } from '../auth.js';
import { initDatabase, saveDatabaseSync } from '../data/dbManager.js';

initDatabase();
ensureAdminAccount({ forceReset: true });
saveDatabaseSync();

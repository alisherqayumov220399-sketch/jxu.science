/**
 * Administrator parolini tiklash:  npm run reset-admin
 * Muhim: buyruqni server TO'XTATILGAN holatda bajaring.
 * ADMIN_PASSWORD muhit o'zgaruvchisi berilsa, aynan o'sha parol o'rnatiladi.
 */
import { ensureAdminAccount } from '../auth.js';
import { initDatabase, saveDatabaseSync } from '../data/dbManager.js';

initDatabase();
ensureAdminAccount({ forceReset: true });
saveDatabaseSync();

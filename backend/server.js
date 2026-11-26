import { createApp } from './app.js';
import { ensureAdminAccount } from './auth.js';
import { flushOnExit, initDatabase } from './data/dbManager.js';
import { DATA_DIR, getSessionSecret } from './config.js';

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

initDatabase();
getSessionSecret();
ensureAdminAccount();
flushOnExit();

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log('========================================================');
  console.log(' [Ilm+] Server ishga tushdi');
  console.log(`   Manzil:  http://localhost:${PORT}`);
  console.log(`   Holat:   http://localhost:${PORT}/api/health`);
  console.log(`   Ma'lumotlar papkasi: ${DATA_DIR}`);
  console.log('========================================================');
});

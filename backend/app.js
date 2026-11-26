import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import apiRoutes from './routes/apiRoutes.js';
import { requireAuth } from './auth.js';
import { DIST_DIR, UPLOAD_DIR, ensureDirs } from './config.js';

export function createApp() {
  ensureDirs();
  const app = express();
  app.disable('x-powered-by');
  // Render/Railway kabi proksi ortida haqiqiy IP manzilni olish uchun
  app.set('trust proxy', 1);

  // Asosiy xavfsizlik sarlavhalari
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // CORS faqat frontend alohida domenda joylashganda kerak (CORS_ORIGIN=https://example.com)
  const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowedOrigins.length) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', system: 'Ilm+ Monitoring API', time: new Date().toISOString() });
  });

  app.use('/api', apiRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'API marshruti topilmadi' });
  });

  // Yuklangan fayllar faqat tizimga kirgan foydalanuvchilarga beriladi
  app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, {
    fallthrough: false,
    setHeaders: (res) => {
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
  }));

  // Frontend (vite build natijasi)
  if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR, { index: false }));
    app.get('*', (req, res, next) => {
      const indexHtml = path.join(DIST_DIR, 'index.html');
      if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
      else next();
    });
  } else {
    app.get('/', (req, res) => {
      res.type('text/plain').send("Frontend hali yig'ilmagan. Avval `npm run build` buyrug'ini bajaring.");
    });
  }

  // Xatolarni qayta ishlash
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[Ilm+ Server xatosi]:', err);
    const message = status >= 500 ? 'Server xatosi yuz berdi' : (err.message || 'So‘rov xatosi');
    if (req.path.startsWith('/uploads') && status === 404) {
      return res.status(404).json({ success: false, message: 'Fayl serverda topilmadi!' });
    }
    res.status(status).json({ success: false, message });
  });

  return app;
}

# Ilm+ — Mustaqil izlanuvchilar monitoringi

Jamoat xavfsizligi universiteti Oliy ta'limdan keyingi ta'lim fakulteti uchun
ilmiy faoliyat monitoringi tizimi: izlanuvchilar bazasi, ish reja va monitoring
hisobotlari, dastlabki ekspertiza, ilmiy seminar / bir martalik kengash va
himoyadan keyingi hujjatlar.

- **Frontend:** React 19 + Vite (`src/`)
- **Backend:** Node.js + Express (`backend/`), ma'lumotlar `db.json` faylida,
  yuklangan fayllar `uploads/` papkasida saqlanadi.

## Tez boshlash

Talab: [Node.js](https://nodejs.org) 20 yoki undan yangi.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

So'ng brauzerda `http://localhost:5000` manzilini oching. Windows'da buning
o'rniga `saytni-ochish.bat` faylini ikki marta bosish kifoya.

**Birinchi ishga tushirishda** server administrator hisobini yaratadi va login
hamda parolni konsolga chiqaradi (nusxasi: `backend/data/ADMIN_PAROL.txt`).
Kirgach, **Sozlamalar → Administrator paroli** bo'limida parolni o'zgartiring va
`ADMIN_PAROL.txt` faylini o'chiring.

## Sozlamalar (muhit o'zgaruvchilari)

| O'zgaruvchi | Vazifasi | Standart qiymat |
|---|---|---|
| `PORT` | Server porti | `5000` |
| `DATA_DIR` | Baza va yuklangan fayllar papkasi (hostingda doimiy diskka yo'naltiring) | `backend/data` va `backend/uploads` |
| `ADMIN_USERNAME` | Birinchi ishga tushirishda yaratiladigan admin logini | `admin` |
| `ADMIN_PASSWORD` | Admin paroli (berilmasa tasodifiy yaratiladi) | — |
| `SESSION_SECRET` | Tokenlarni imzolash kaliti (berilmasa avtomatik yaratilib, `DATA_DIR` da saqlanadi) | — |
| `CORS_ORIGIN` | Frontend boshqa domenda bo'lsa, ruxsat etilgan manzil(lar) | — |

## Foydali buyruqlar

| Buyruq | Vazifasi |
|---|---|
| `npm run dev` + `npm run dev:server` | Ishlab chiqish rejimi (Vite :5173, API :5000) |
| `npm run lint` | Kod tekshiruvi (oxlint) |
| `npm test` | Backend API testlari |
| `npm run check` | Lint + test + build |
| `npm run reset-admin` | Admin parolini tiklash (serverni to'xtatib bajaring) |

## Xavfsizlik

- Barcha API so'rovlari token orqali tekshiriladi; tadqiqotchi faqat o'ziga
  tegishli ma'lumotlarni ko'radi va o'zgartira oladi, hujjatlarini o'zi
  "tasdiqlay" olmaydi.
- Yuklangan fayllar faqat tizimga kirgan foydalanuvchilarga beriladi.
- Ma'lumotlar bazasi (`db.json`), admin paroli va yuklangan fayllar git'ga
  **yuklanmaydi** (`.gitignore`). Ularni hech qachon ommaviy repozitoriyga
  qo'shmang.
- Ma'lumotlarning zaxira nusxasini **Sozlamalar → Ma'lumotlar bazasining zaxira
  nusxasi** orqali muntazam yuklab oling.

Internetga joylash bo'yicha batafsil qo'llanma:
[QOLLANMA_INTERNETGA_JOYLASH.md](QOLLANMA_INTERNETGA_JOYLASH.md).

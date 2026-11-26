# Ilm+ tizimini ishga tushirish va internetga joylash

Tizim ikki qismdan iborat: **React frontend** va **Node.js server**. Server
bir vaqtning o'zida frontendni ham tarqatadi, shuning uchun bitta Node.js
xizmatini ishga tushirish yetarli. Faqat statik hosting (GitHub Pages, Netlify,
Vercel) **yetarli emas** — u yerda server, baza va fayl ombori ishlamaydi.

---

## 1. O'z kompyuteringizda yoki lokal tarmoqda

1. [Node.js](https://nodejs.org) (LTS, 20+) o'rnating.
2. Windows: `saytni-ochish.bat` faylini ikki marta bosing.
   Boshqa tizimlar: `npm install`, `npm run build`, `npm start`.
3. Admin login: **`OTKTF`**. Parolni o'zingiz belgilash uchun serverni
   to'xtatib bir marta bajaring (Windows `cmd`):
   `set ADMIN_PASSWORD=<parolingiz>` va `npm run reset-admin`.
   Aks holda birinchi ishga tushirishda tasodifiy parol konsolga va
   `backend/data/ADMIN_PAROL.txt` fayliga yoziladi.
4. Brauzerda `http://localhost:5000` ni oching.

Institut tarmog'idagi boshqa kompyuterlardan kirish uchun server kompyuterining
IP manzilidan foydalaning, masalan `http://192.168.1.45:5000`
(IP manzilni `ipconfig` buyrug'i bilan bilib olasiz).

---

## 2. Internetga joylash (Render.com)

1. Repozitoriyni GitHub'ga yuklang. **Tavsiya:** repozitoriyni *Private*
   (yopiq) qiling.
2. [Render.com](https://render.com) → **New + → Blueprint** → repozitoriyni
   tanlang. `render.yaml` fayli barcha sozlamalarni o'zi qo'yadi.
3. Environment bo'limida `ADMIN_PASSWORD` ga o'z parolingizni kiriting
   (login standart holatda `OTKTF`).
4. Deploy tugagach berilgan manzil (masalan `https://ilm-monitoring.onrender.com`)
   orqali tizimga kiring.

> **Muhim:** ma'lumotlar saqlanib qolishi uchun doimiy disk (persistent disk)
> kerak — `render.yaml` uni `/var/data` ga ulaydi. Disk faqat pullik tarifda
> mavjud. Bepul tarifda server har qayta ishga tushganda baza va fayllar
> o'chib ketadi.

### Boshqa hostinglar (Railway, VPS, Docker)

- Build: `npm ci && npm run build`, start: `npm start`.
- `DATA_DIR` muhit o'zgaruvchisini doimiy diskdagi papkaga yo'naltiring.
- Docker: `docker build -t ilm .` va
  `docker run -p 5000:5000 -v ilm-data:/data ilm`.

---

## 3. Eski ma'lumotlarni yangi serverga ko'chirish

Avvalgi versiyada baza `backend/data/db.json` sifatida repozitoriyda turgan
edi. Endi u xavfsizlik sababli git'dan olib tashlandi. Mavjud ma'lumotlarni
saqlab qolish uchun:

1. Eski faylni tiklang:
   `git show 29a5ab2:backend/data/db.json > eski-baza.json`
2. Yangi serverda admin sifatida kiring → **Sozlamalar → Zaxiradan tiklash** →
   `eski-baza.json` ni tanlang.
3. Eski parollar ommaviy repozitoriyda ochiq turgani sababli,
   **Sozlamalar → Parollarni yangilash** tugmasi bilan barcha izlanuvchilar
   uchun yangi parollar yarating va Excel faylni izlanuvchilarga tarqating.

---

## 4. Admin parolini unutgan bo'lsangiz

Serverni to'xtating va bajaring:

```bash
npm run reset-admin
```

`ADMIN_PASSWORD` berilgan bo'lsa o'sha parol, aks holda yangi tasodifiy parol
o'rnatiladi (konsolga va `ADMIN_PAROL.txt` fayliga yoziladi).

---

## 5. Zaxira nusxa

**Sozlamalar → Ma'lumotlar bazasining zaxira nusxasi → Yuklab olish** tugmasi
butun bazani JSON fayl sifatida beradi. Uni muntazam (masalan haftada bir)
saqlab boring. Yuklangan fayllar (`uploads` papkasi) alohida nusxalanadi.

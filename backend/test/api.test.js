import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilm-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin-test-parol';

const { initDatabase, mutateDatabase } = await import('../data/dbManager.js');
const { ensureAdminAccount } = await import('../auth.js');
const { createApp } = await import('../app.js');

let server;
let base;

async function api(pathname, { token, method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${pathname}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function login(username, password, role) {
  const res = await api('/api/auth/login', { method: 'POST', body: { username, password, role } });
  return res.json?.token;
}

before(async () => {
  initDatabase();
  ensureAdminAccount();
  mutateDatabase((db) => {
    db.accounts = [
      { username: 'ali.valiyev', password: 'ali-parol-1', researcherName: 'Valiyev Ali', stage: 2, role: 'researcher' },
      { username: 'vali.aliyev', password: 'vali-parol-1', researcherName: 'Aliyev Vali', stage: 1, role: 'researcher' }
    ];
    db.researchers = [
      { id: 'r1', name: 'Valiyev Ali', username: 'ali.valiyev', stage: 2, field: 'Huquq' },
      { id: 'r2', name: 'Aliyev Vali', username: 'vali.aliyev', stage: 1, field: 'Iqtisod' }
    ];
    db.postDefenseFiles = [
      { id: 'pd-v', reqId: 'pd_1', username: 'vali.aliyev', name: 'v.pdf', status: 'Kutilmoqda' }
    ];
  });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('ma\'lumotlar autentifikatsiyasiz berilmaydi', async () => {
  assert.equal((await api('/api/sync')).status, 401);
  assert.equal((await api('/api/sync', { method: 'POST', body: { changes: {} } })).status, 401);
  assert.equal((await api('/api/sync/version')).status, 401);
});

test('noto\'g\'ri parol rad etiladi', async () => {
  const res = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'xato', role: 'admin' } });
  assert.equal(res.status, 401);
});

test('admin barcha ma\'lumotlarni, parollar bilan ko\'radi', async () => {
  const token = await login('admin', 'admin-test-parol', 'admin');
  assert.ok(token);
  const res = await api('/api/sync', { token });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.accounts.length, 2);
  assert.equal(res.json.data.accounts[0].password, 'ali-parol-1');
  assert.equal(res.json.data.admin, undefined);
});

test('tadqiqotchi faqat o\'z ma\'lumotlarini ko\'radi va parollar yashirin', async () => {
  const token = await login('ali.valiyev', 'ali-parol-1', 'researcher');
  assert.ok(token);
  const res = await api('/api/sync', { token });
  assert.equal(res.json.data.accounts.length, 1);
  assert.equal(res.json.data.accounts[0].password, undefined);
  assert.equal(res.json.data.researchers.length, 1);
  assert.equal(res.json.data.postDefenseFiles.length, 0);
  const me = await api('/api/auth/me', { token });
  assert.equal(me.json.user.field, 'Huquq');
  assert.equal(me.json.user.stage, 2);
});

test('tadqiqotchi boshqa birovning yozuvini o\'zgartira olmaydi va o\'zini tasdiqlay olmaydi', async () => {
  const token = await login('ali.valiyev', 'ali-parol-1', 'researcher');
  const res = await api('/api/sync', {
    token,
    method: 'POST',
    body: {
      changes: {
        postDefenseFiles: {
          upsert: [
            { id: 'pd-v', username: 'vali.aliyev', status: 'Qabul qilindi' },
            { id: 'pd-a', reqId: 'pd_1', username: 'vali.aliyev', name: 'a.pdf', status: 'Qabul qilindi' }
          ],
          remove: []
        },
        accounts: { upsert: [{ username: 'vali.aliyev', password: 'buzildi' }], remove: [] }
      }
    }
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.rejected >= 2);

  const adminToken = await login('admin', 'admin-test-parol', 'admin');
  const all = (await api('/api/sync', { token: adminToken })).json.data;
  const foreign = all.postDefenseFiles.find((f) => f.id === 'pd-v');
  assert.equal(foreign.status, 'Kutilmoqda');
  const own = all.postDefenseFiles.find((f) => f.id === 'pd-a');
  assert.equal(own.username, 'ali.valiyev');
  assert.equal(own.status, 'Kutilmoqda');
  assert.equal(all.accounts.find((a) => a.username === 'vali.aliyev').password, 'vali-parol-1');
});

test('admin o\'zgarishlari qo\'llanadi va reviziya oshadi', async () => {
  const token = await login('admin', 'admin-test-parol', 'admin');
  const v1 = (await api('/api/sync/version', { token })).json.revision;
  const res = await api('/api/sync', {
    token,
    method: 'POST',
    body: { changes: { postDefenseFiles: { upsert: [{ id: 'pd-v', reqId: 'pd_1', username: 'vali.aliyev', name: 'v.pdf', status: 'Qabul qilindi' }], remove: [] } } }
  });
  assert.equal(res.json.applied, 1);
  const v2 = (await api('/api/sync/version', { token })).json.revision;
  assert.ok(v2 > v1);
});

test('fayl yuklash va faqat token bilan yuklab olish', async () => {
  const token = await login('ali.valiyev', 'ali-parol-1', 'researcher');
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4 test']), 'hujjat.pdf');
  form.append('category', 'Test');
  const up = await api('/api/upload', { token, method: 'POST', form });
  assert.equal(up.status, 201);
  const url = up.json.data.fileUrl;
  assert.match(url, /^\/uploads\/.+\.pdf$/);
  assert.equal((await api(url)).status, 401);
  const ok = await api(`${url}?token=${encodeURIComponent(token)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '%PDF-1.4 test');

  const bad = new FormData();
  bad.append('file', new Blob(['<script>']), 'x.html');
  assert.equal((await api('/api/upload', { token, method: 'POST', form: bad })).status, 400);
});

test('parolni o\'zgartirish eski tokenni bekor qiladi', async () => {
  const token = await login('vali.aliyev', 'vali-parol-1', 'researcher');
  const wrong = await api('/api/auth/change-password', { token, method: 'POST', body: { currentPassword: 'xato', newPassword: 'yangi-parol' } });
  assert.equal(wrong.status, 400);
  const res = await api('/api/auth/change-password', { token, method: 'POST', body: { currentPassword: 'vali-parol-1', newPassword: 'yangi-parol' } });
  assert.equal(res.status, 200);
  assert.ok(res.json.token);
  assert.equal((await api('/api/auth/me', { token })).status, 401);
  assert.equal((await api('/api/auth/me', { token: res.json.token })).status, 200);
});

test('zaxira nusxa faqat admin uchun', async () => {
  const researcher = await login('ali.valiyev', 'ali-parol-1', 'researcher');
  assert.equal((await api('/api/admin/backup', { token: researcher })).status, 403);
  const admin = await login('admin', 'admin-test-parol', 'admin');
  const backup = await api('/api/admin/backup', { token: admin });
  assert.equal(backup.status, 200);
  assert.equal(backup.json.admin, undefined);
  assert.ok(Array.isArray(backup.json.accounts));
  const restore = await api('/api/admin/restore', { token: admin, method: 'POST', body: { data: backup.json } });
  assert.equal(restore.status, 200);
  // Admin hisobi tiklashdan keyin ham ishlaydi
  assert.ok(await login('admin', 'admin-test-parol', 'admin'));
});

test('noma\'lum API marshruti 404 qaytaradi', async () => {
  assert.equal((await api('/api/yoq')).status, 404);
});

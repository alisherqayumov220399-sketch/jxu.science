/**
 * Ilm+ tizimi uchun markazlashtirilgan API servisi.
 * Barcha so'rovlar token (Authorization: Bearer) bilan yuboriladi;
 * ma'lumotlar faqat serverda saqlanadi.
 */

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const TOKEN_KEY = 'ilm_token'

let authToken = null
try { authToken = localStorage.getItem(TOKEN_KEY) } catch { /* ignore */ }

let credentialChangeInFlight = false
let isConnected = true
const connectionListeners = new Set()
let unauthorizedHandler = null

// Avvalgi versiyalar brauzerda butun bazani (parollar bilan) saqlab qo'ygan — ularni tozalaymiz
try {
  ;['ilm_accounts', 'ilm_researchers', 'ilm_expertise_cases', 'ilm_monitoring_files', 'ilm_monitoring_reports',
    'ilm_kengash_files', 'ilm_post_defense_files', 'ilm_activity_log', 'ilm_normative_docs', 'ilm_auth',
    'ilm_cached_sync_data', 'ilm_last_sync_revision'].forEach((key) => localStorage.removeItem(key))
} catch { /* ignore */ }

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export function getToken() {
  return authToken
}

export function setToken(token) {
  authToken = token || null
  try {
    if (authToken) localStorage.setItem(TOKEN_KEY, authToken)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler
}

export function setConnectionStatus(status) {
  if (isConnected !== status) {
    isConnected = status
    connectionListeners.forEach((listener) => listener(status))
  }
}

export function onConnectionChange(listener) {
  connectionListeners.add(listener)
  listener(isConnected)
  return () => connectionListeners.delete(listener)
}

async function request(path, { method = 'GET', body, formData, auth = true } = {}) {
  const headers = { Accept: 'application/json' }
  const tokenUsed = auth ? authToken : null
  if (tokenUsed) headers.Authorization = `Bearer ${tokenUsed}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      cache: 'no-store',
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined)
    })
  } catch {
    setConnectionStatus(false)
    throw new ApiError("Serverga ulanib bo'lmadi. Internet aloqasini tekshiring.", 0)
  }
  setConnectionStatus(true)

  let json = null
  try { json = await res.json() } catch { /* javob JSON emas */ }

  // Parol almashtirilayotgan paytda eski token bilan ketgan so'rov rad etilsa,
  // foydalanuvchini tizimdan chiqarmaymiz — so'rov yangi token bilan qayta yuboriladi.
  const staleToken = tokenUsed !== authToken || credentialChangeInFlight
  if (res.status === 401 && auth && !staleToken) {
    setToken(null)
    if (unauthorizedHandler) unauthorizedHandler()
  }
  if (!res.ok || (json && json.success === false)) {
    throw new ApiError(json?.message || `Server xatosi: ${res.status}`, res.status)
  }
  return json
}

/* ---------------- Autentifikatsiya ---------------- */

export async function loginRequest(username, password, role) {
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password, role }, auth: false })
  setToken(result.token)
  return result.user
}

export async function fetchCurrentUser() {
  const result = await request('/api/auth/me')
  return result.user
}

export async function changePassword(currentPassword, newPassword) {
  credentialChangeInFlight = true
  try {
    const result = await request('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } })
    if (result.token) setToken(result.token)
    return result
  } finally {
    credentialChangeInFlight = false
  }
}

export function logout() {
  setToken(null)
}

/* ---------------- Sinxronizatsiya ---------------- */

export async function fetchServerSync() {
  const result = await request('/api/sync')
  return { revision: result.revision, data: result.data }
}

export async function fetchServerRevision() {
  const result = await request('/api/sync/version')
  return result.revision
}

/** changes: { [collection]: { upsert, remove } } */
export async function pushServerChanges(changes) {
  return request('/api/sync', { method: 'POST', body: { changes } })
}

/** Sahifa yopilayotganda yuborilmagan o'zgarishlarni jo'natish (javob kutilmaydi). */
export function flushServerChanges(changes) {
  if (!authToken) return
  try {
    fetch(`${API_BASE}/api/sync`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ changes })
    }).catch(() => {})
  } catch { /* ignore */ }
}

/* ---------------- Fayllar ---------------- */

/**
 * Faylni serverga yuklaydi. Xatolik bo'lsa istisno (Error) tashlaydi —
 * fayl serverga tushmagan bo'lsa, yozuv saqlanmasligi kerak.
 */
export async function uploadRealFile(file, category = 'Umumiy', metadata = {}) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('category', category)
  if (metadata.reqId) formData.append('reqId', metadata.reqId)
  const result = await request('/api/upload', { method: 'POST', formData })
  return {
    success: true,
    fileUrl: result.data.fileUrl,
    fileName: result.data.fileName,
    originalName: result.data.originalName,
    size: result.data.size,
    mimeType: result.data.mimeType
  }
}

/* ---------------- Admin: zaxira ---------------- */

export async function downloadBackup() {
  const res = await fetch(`${API_BASE}/api/admin/backup`, { headers: { Authorization: `Bearer ${authToken}` } })
  if (!res.ok) throw new ApiError(`Zaxira nusxani olishda xatolik: ${res.status}`, res.status)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ilm-baza-zaxira-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function restoreBackup(data) {
  return request('/api/admin/restore', { method: 'POST', body: { data } })
}

/* ---------------- Jonli sinxronizatsiya ---------------- */

/**
 * Har bir necha soniyada server reviziyasini tekshiradi; o'zgarish bo'lsa
 * onChange(revision) chaqiriladi.
 */
export function startLiveSync(getKnownRevision, onChange, intervalMs = 4000) {
  let checking = false
  const check = async () => {
    if (checking || !authToken || document.hidden) return
    checking = true
    try {
      const revision = await fetchServerRevision()
      if (revision !== getKnownRevision()) onChange(revision)
    } catch {
      // ulanish holati request() ichida yangilanadi
    } finally {
      checking = false
    }
  }
  const intervalId = setInterval(check, intervalMs)
  const onFocus = () => check()
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onFocus)
  document.addEventListener('visibilitychange', onFocus)
  return () => {
    clearInterval(intervalId)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('online', onFocus)
    document.removeEventListener('visibilitychange', onFocus)
  }
}

/** Serverdagi faylni ochish yoki yuklab olish (token bilan). */
export function openOrDownloadFile(fileUrl, fileName = 'hujjat') {
  if (!fileUrl || String(fileUrl).startsWith('blob:')) {
    alert("Bu fayl serverga yuklanmagan yoki endi mavjud emas. Iltimos, faylni qayta yuklang.")
    return
  }
  let fullUrl = String(fileUrl)
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `${API_BASE}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
  }
  const isOwnServerFile = fullUrl.includes('/uploads/')
  if (isOwnServerFile && authToken) {
    fullUrl += `${fullUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`
  }
  const link = document.createElement('a')
  link.href = fullUrl
  link.download = fileName
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

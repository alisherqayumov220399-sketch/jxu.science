/**
 * Noyob identifikator. crypto.randomUUID faqat HTTPS yoki localhost'da mavjud,
 * shuning uchun lokal tarmoq (http://192.168.x.x) orqali ochilganda ham ishlashi
 * uchun zaxira varianti bor.
 */
export function uid(prefix = '') {
  const c = globalThis.crypto
  let id
  if (c && typeof c.randomUUID === 'function') {
    id = c.randomUUID()
  } else if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  } else {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  }
  return prefix ? `${prefix}-${id}` : id
}

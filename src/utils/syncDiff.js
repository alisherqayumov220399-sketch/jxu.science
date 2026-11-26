/**
 * To'plamlar (massivlar) o'rtasidagi farqni hisoblash va qo'llash.
 * Server bilan sinxronizatsiyada faqat o'zgargan yozuvlar yuboriladi,
 * shuning uchun bir vaqtda ishlayotgan foydalanuvchilar bir-birining
 * ma'lumotlarini o'chirib yubormaydi.
 */

export function recordKey(collection, record) {
  if (!record || typeof record !== 'object') return null
  const key = collection === 'accounts' ? record.username : record.id
  return key === undefined || key === null || key === '' ? null : String(key)
}

function indexByKey(collection, list) {
  const map = new Map()
  for (const record of list || []) {
    const key = recordKey(collection, record)
    if (key !== null && !map.has(key)) map.set(key, record)
  }
  return map
}

/** base -> next o'zgarishlari: { upsert: [...], remove: [...] } yoki null */
export function computeDiff(collection, base, next) {
  if (base === next) return null
  const baseMap = indexByKey(collection, base)
  const nextMap = indexByKey(collection, next)
  const upsert = []
  const remove = []
  for (const [key, record] of nextMap) {
    const prev = baseMap.get(key)
    if (prev === record) continue
    if (!prev || JSON.stringify(prev) !== JSON.stringify(record)) upsert.push(record)
  }
  for (const key of baseMap.keys()) {
    if (!nextMap.has(key)) remove.push(key)
  }
  return upsert.length || remove.length ? { upsert, remove } : null
}

/** diff ni list ga qo'llaydi (yangi yozuvlar boshiga qo'shiladi). */
export function applyDiff(collection, list, diff) {
  if (!diff) return list
  const removeSet = new Set(diff.remove.map(String))
  const upsertMap = new Map(diff.upsert.map((r) => [recordKey(collection, r), r]))
  const result = []
  for (const record of list || []) {
    const key = recordKey(collection, record)
    if (removeSet.has(key)) continue
    if (upsertMap.has(key)) {
      result.push(upsertMap.get(key))
      upsertMap.delete(key)
    } else {
      result.push(record)
    }
  }
  return [...upsertMap.values(), ...result]
}

/** Mahalliy (hali yuborilmagan) o'zgarishlarni serverdan kelgan yangi ma'lumot ustiga qo'yadi. */
export function rebase(collection, local, base, remote) {
  const pending = computeDiff(collection, base, local)
  return pending ? applyDiff(collection, remote, pending) : remote
}

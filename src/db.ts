export interface Draft { blob: Blob; name: string; state: string; thumb?: string; savedAt: number }
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open('local-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise((res, rej) => { const r = f(db.transaction('kv', mode).objectStore('kv')); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error) })
}
export const getDraft = () => tx<Draft | undefined>('readonly', s => s.get('draft')).catch(() => undefined)
export const putDraft = (d: Draft) => tx('readwrite', s => s.put(d, 'draft')).catch(() => undefined)
export const delDraft = () => tx('readwrite', s => s.delete('draft')).catch(() => undefined)

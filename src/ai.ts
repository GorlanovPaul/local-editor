export type Prog = (text: string, frac?: number, eta?: number) => void
let w: Worker | null = null, seq = 0
const pend = new Map<number, { res: (v: any) => void; rej: (e: any) => void; p: Prog }>()
function worker() {
  if (w) return w
  w = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e) => {
    const d = e.data, t = pend.get(d.id); if (!t) return
    if (d.type === 'progress') t.p(`Скачиваю: ${Math.round(d.loaded / d.total * 100)}%`, d.loaded / d.total)
    else if (d.type === 'status') t.p(d.text, d.frac, d.eta)
    else { pend.delete(d.id); d.type === 'error' ? t.rej(new Error(d.error)) : t.res(d.result) }
  }
  w.onerror = (e) => { console.error('AI worker', e); pend.forEach(t => t.rej(new Error(e.message || 'worker'))); pend.clear(); w = null }
  return w
}
export function call(task: string, args: any, p: Prog, transfer: Transferable[] = []): Promise<any> {
  const id = ++seq
  return new Promise((res, rej) => { pend.set(id, { res, rej, p }); worker().postMessage({ id, task, ...args }, transfer) })
}
/** stop everything (user pressed «Отмена») */
export function cancelAI() { if (w) { w.terminate(); w = null } pend.forEach(t => t.rej(Object.assign(new Error('cancelled'), { name: 'AbortError' }))); pend.clear() }
/** read pixels of an image source (optionally resized to fit `max` long side) */
export function pixels(src: CanvasImageSource & { width: number; height: number }, max = 1e9, sx = 0, sy = 0, sw = src.width, sh = src.height) {
  const s = Math.min(1, max / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })!; x.imageSmoothingQuality = 'high'; x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h)
  return { data: x.getImageData(0, 0, w, h).data, w, h }
}
export function alphaCanvas(r: { w: number; h: number; alpha: Uint8ClampedArray }) {
  const c = document.createElement('canvas'); c.width = r.w; c.height = r.h
  const x = c.getContext('2d')!, img = x.createImageData(r.w, r.h)
  for (let i = 0; i < r.alpha.length; i++) { const j = i * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = 255; img.data[j + 3] = r.alpha[i] }
  x.putImageData(img, 0, 0); return c
}
export const fmtEta = (s?: number) => s == null || !isFinite(s) ? '' : s < 60 ? `осталось ≈ ${Math.max(1, Math.round(s))} с` : `осталось ≈ ${Math.round(s / 60)} мин`

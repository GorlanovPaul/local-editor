import { process, type Job } from './ops'
let worker: Worker | null = null, seq = 0
const pending = new Map<number, (v: any) => void>()
try {
  if (typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('2d')) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id) }
    worker.onerror = () => { worker = null }
  }
} catch { worker = null }
export const usingWorker = () => !!worker
async function viaWorker(bmp: ImageBitmap, job: Job): Promise<any> {
  const copy = await createImageBitmap(bmp), id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, (d) => d.error ? rej(new Error(d.error)) : res(d))
    worker!.postMessage({ id, bmp: copy, job }, [copy])
  })
}
const mk = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })
export async function run(bmp: ImageBitmap, job: Job): Promise<ImageBitmap> {
  if (worker) try { return (await viaWorker(bmp, job)).bmp } catch { /* fallback */ }
  return createImageBitmap(await process(bmp, job, mk) as HTMLCanvasElement)
}
export async function exportBlob(bmp: ImageBitmap, job: Job & { kind: 'export' }): Promise<Blob> {
  if (worker) try { return (await viaWorker(bmp, job)).blob } catch { /* fallback */ }
  const c = await process(bmp, job, mk) as HTMLCanvasElement
  return new Promise((r, j) => c.toBlob((b) => b ? r(b) : j(new Error('toBlob')), job.type, job.quality))
}

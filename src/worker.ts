/// <reference lib="webworker" />
import { process, type Job } from './ops'
self.onmessage = async (e: MessageEvent<{ id: number; bmp: ImageBitmap; job: Job }>) => {
  const { id, bmp, job } = e.data
  try {
    const canvas = await process(bmp, job, (w, h) => new OffscreenCanvas(w, h))
    if (job.kind === 'export') {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: job.type, quality: job.quality })
      ;(self as any).postMessage({ id, blob })
    } else {
      const out = (canvas as OffscreenCanvas).transferToImageBitmap()
      ;(self as any).postMessage({ id, bmp: out }, [out])
    }
  } catch (err) { (self as any).postMessage({ id, error: String(err) }) }
}

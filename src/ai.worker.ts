/// <reference lib="webworker" />
import type * as TJ from '@huggingface/transformers'
import type * as ORT from 'onnxruntime-web'
// Loaded lazily from jsDelivr (pinned versions) and runtime-cached by the service worker; not bundled/precached.
const TJ_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js'
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort.all.bundle.min.mjs'
let T: typeof TJ, ort: typeof ORT
async function libs() {
  if (!T) { T = await import(/* @vite-ignore */ TJ_URL); T.env.allowLocalModels = false; T.env.useBrowserCache = true }
  return T
}
type RawImage = TJ.RawImage

let id = 0
const post = (m: any, t?: Transferable[]) => (self as any).postMessage({ id, ...m }, t || [])
const files = new Map<string, [number, number]>()
const progress = (p: any) => {
  if (p.status !== 'progress' || !p.total) return
  files.set(p.file, [p.loaded, p.total]); let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b })
  post({ type: 'progress', loaded: l, total: t })
}
let gpuOk: boolean | null = null
async function hasGpu() {
  if (gpuOk === null) gpuOk = !!(self.navigator as any).gpu && !!(await (self.navigator as any).gpu.requestAdapter().catch(() => null))
  return gpuOk
}
async function withFallback<T>(f: (device: string, gpu: boolean) => Promise<T>): Promise<T> {
  if (await hasGpu()) try { return await f('webgpu', true) } catch (e) { console.warn('webgpu failed', e) }
  return f('wasm', false)
}
const dev = new Map<string, string>()

function toRaw(d: { data: Uint8ClampedArray; w: number; h: number }) { return new T.RawImage(d.data, d.w, d.h, 4) }

// ---- background removal (RMBG-1.4) ----
let bg: { model: any; proc: any } | null = null
async function bgRemove(img: any) {
  files.clear(); const { AutoProcessor, AutoModel } = await libs()
  if (!bg) {
    const proc = await AutoProcessor.from_pretrained('briaai/RMBG-1.4', { progress_callback: progress, config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255, size: { width: 1024, height: 1024 } } as any })
    const model = await withFallback(async (d, g) => { const m = await AutoModel.from_pretrained('briaai/RMBG-1.4', { device: d as any, dtype: (g ? 'fp16' : 'q8') as any, progress_callback: progress, config: { model_type: 'custom' } as any }); dev.set('bg', d); return m })
    bg = { model, proc }
  }
  post({ type: 'status', text: 'Удаление фона (' + dev.get('bg') + ')…' })
  const raw = toRaw(img), { pixel_values } = await bg.proc(raw), { output } = await bg.model({ input: pixel_values })
  const m = await T.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(raw.width, raw.height)
  const n = m.width * m.height, a = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) a[i] = m.data[i * m.channels]
  return { w: m.width, h: m.height, alpha: a }
}

// ---- segment anything (SlimSAM) ----
let sam: any, samProc: any, emb: { key: string; e: any; inputs: any } | null = null
async function segment(img: any, key: string, pts: number[][]) {
  const { AutoProcessor, SamModel, Tensor } = await libs()
  if (!sam) {
    files.clear()
    samProc = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform', { progress_callback: progress })
    sam = await withFallback(async (d) => { const m = await SamModel.from_pretrained('Xenova/slimsam-77-uniform', { device: d as any, dtype: 'q8' as any, progress_callback: progress }); dev.set('sam', d); return m })
  }
  if (!emb || emb.key !== key) {
    post({ type: 'status', text: 'Анализ изображения…' })
    const inputs = await samProc(toRaw(img)); emb = { key, inputs, e: await sam.get_image_embeddings(inputs) }
  }
  post({ type: 'status', text: 'Выделение…' })
  const [rh, rw] = emb.inputs.reshaped_input_sizes[0]
  const input_points = new Tensor('float32', pts.flatMap(p => [p[0] * rw, p[1] * rh]), [1, 1, pts.length, 2])
  const input_labels = new Tensor('int64', new BigInt64Array(pts.map(p => BigInt(p[2] ?? 1))), [1, 1, pts.length])
  const out = await sam({ ...emb.e, input_points, input_labels })
  const masks = await samProc.post_process_masks(out.pred_masks, emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes)
  const m = masks[0], scores = out.iou_scores.data as Float32Array
  let best = 0; for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
  const [, , H, W] = m.dims, n = W * H, a = new Uint8ClampedArray(n), src = m.data
  for (let i = 0; i < n; i++) a[i] = src[best * n + i] ? 255 : 0
  return { w: W, h: H, alpha: a }
}

// ---- inpainting (MI-GAN, MIT) ----
const MIGAN = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx'
let migan: ORT.InferenceSession | null = null
async function fetchCached(url: string) {
  const c = await caches.open('local-editor-models'); let r = await c.match(url)
  if (!r) {
    const res = await fetch(url); if (!res.ok || !res.body) throw new Error('Не удалось загрузить модель: ' + res.status)
    const total = +(res.headers.get('content-length') || 0), rd = res.body.getReader(), parts: Uint8Array[] = []; let l = 0
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); l += value.length; if (total) post({ type: 'progress', loaded: l, total }) }
    const blob = new Blob(parts as BlobPart[]); await c.put(url, new Response(blob)); return new Uint8Array(await blob.arrayBuffer())
  }
  return new Uint8Array(await r.arrayBuffer())
}
async function inpaint(img: { data: Uint8ClampedArray; w: number; h: number }, mask: Uint8ClampedArray) {
  if (!migan) {
    ort ||= await import(/* @vite-ignore */ ORT_URL)
    const buf = await fetchCached(MIGAN)
    migan = await withFallback(async (d) => { const s = await ort.InferenceSession.create(buf, { executionProviders: [d] }); dev.set('inpaint', d); return s })
  }
  post({ type: 'status', text: 'Удаление объекта (' + dev.get('inpaint') + ')…' })
  const { w, h, data } = img, n = w * h, chw = new Uint8Array(3 * n), m = new Uint8Array(n)
  for (let i = 0; i < n; i++) { chw[i] = data[i * 4]; chw[n + i] = data[i * 4 + 1]; chw[2 * n + i] = data[i * 4 + 2]; m[i] = mask[i] > 127 ? 0 : 255 }
  const r = await migan.run({ image: new ort.Tensor('uint8', chw, [1, 3, h, w]), mask: new ort.Tensor('uint8', m, [1, 1, h, w]) })
  const o = r.result.data as Uint8Array, out = new Uint8ClampedArray(4 * n)
  for (let i = 0; i < n; i++) { out[i * 4] = o[i]; out[i * 4 + 1] = o[n + i]; out[i * 4 + 2] = o[2 * n + i]; out[i * 4 + 3] = 255 }
  return { w, h, data: out }
}

// ---- upscale (Swin2SR) with tiling ----
const up = new Map<number, any>()
async function upscale(img: { data: Uint8ClampedArray; w: number; h: number }, scale: number) {
  const { pipeline } = await libs()
  if (!up.has(scale)) {
    files.clear()
    const model = scale === 4 ? 'Xenova/swin2SR-compressed-sr-x4-48' : 'Xenova/swin2SR-classical-sr-x2-64'
    up.set(scale, await withFallback(async (d, g) => { const p = await pipeline('image-to-image', model, { device: d as any, dtype: (g ? 'fp16' : 'fp32') as any, progress_callback: progress }); dev.set('up', d); return p }))
  }
  const p = up.get(scale), { w, h, data } = img, TS = 128, O = 12, W = w * scale, H = h * scale, out = new Uint8ClampedArray(W * H * 4)
  const nx = Math.ceil(w / TS), ny = Math.ceil(h / TS); let k = 0
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    post({ type: 'status', text: `Увеличение ×${scale}: фрагмент ${++k} из ${nx * ny} (${dev.get('up')})`, frac: k / (nx * ny) })
    const x0 = tx * TS, y0 = ty * TS, x1 = Math.min(w, x0 + TS), y1 = Math.min(h, y0 + TS)
    const sx = Math.max(0, x0 - O), sy = Math.max(0, y0 - O), ex = Math.min(w, x1 + O), ey = Math.min(h, y1 + O), tw = ex - sx, th = ey - sy
    const tile = new Uint8ClampedArray(tw * th * 4)
    for (let y = 0; y < th; y++) tile.set(data.subarray(((sy + y) * w + sx) * 4, ((sy + y) * w + ex) * 4), y * tw * 4)
    const r: RawImage = await p(new T.RawImage(tile, tw, th, 4)), rc = r.channels, rw = r.width
    for (let y = (y0 - sy) * scale; y < (y1 - sy) * scale; y++) for (let x = (x0 - sx) * scale; x < (x1 - sx) * scale; x++) {
      const di = ((sy * scale + y) * W + sx * scale + x) * 4, si = (y * rw + x) * rc
      out[di] = r.data[si]; out[di + 1] = r.data[si + 1]; out[di + 2] = r.data[si + 2]; out[di + 3] = 255
    }
  }
  return { w: W, h: H, data: out }
}

self.onmessage = async (e: MessageEvent) => {
  const d = e.data; id = d.id
  try {
    let r: any
    if (d.task === 'bg') r = await bgRemove(d.img)
    else if (d.task === 'sam') r = await segment(d.img, d.key, d.pts)
    else if (d.task === 'inpaint') r = await inpaint(d.img, d.mask)
    else if (d.task === 'upscale') r = await upscale(d.img, d.scale)
    post({ type: 'done', result: r }, [(r.alpha || r.data).buffer])
  } catch (err) { post({ type: 'error', error: String((err as any)?.message || err) }) }
}

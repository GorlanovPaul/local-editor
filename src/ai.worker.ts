/// <reference lib="webworker" />
import type * as TJ from '@huggingface/transformers'
import type * as ORT from 'onnxruntime-web'
import { BG_REPO, RMBG_REPO, SAM_REPO, UP_REPO, LAMA_URL, MIGAN_URL } from './models'
// Libraries are loaded lazily from jsDelivr (pinned) and runtime-cached by the service worker.
const TJ_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js'
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort.all.bundle.min.mjs'
let T: typeof TJ, ort: typeof ORT
async function libs() { if (!T) { T = await import(/* @vite-ignore */ TJ_URL); T.env.allowLocalModels = false; T.env.useBrowserCache = true } return T }
type Raw = TJ.RawImage
type Img = { data: Uint8ClampedArray; w: number; h: number }

let id = 0
const post = (m: any, t?: Transferable[]) => (self as any).postMessage({ id, ...m }, t || [])
const files = new Map<string, [number, number]>()
const progress = (p: any) => {
  if (p.status !== 'progress' || !p.total) return
  files.set(p.file, [p.loaded, p.total]); let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b })
  post({ type: 'progress', loaded: l, total: t })
}
let gpu: boolean | null = null, forceWasm = false
async function device() {
  if (forceWasm) return 'wasm'
  if (gpu === null) gpu = !!(self.navigator as any).gpu && !!(await (self.navigator as any).gpu.requestAdapter().catch(() => null))
  return gpu ? 'webgpu' : 'wasm'
}
const models = new Map<string, any>()
/** get-or-create a model; on WebGPU failure (load or run) retry everything on WASM */
async function model<T>(key: string, make: (d: string) => Promise<T>): Promise<T> {
  if (!models.has(key)) { files.clear(); const d = await device(); try { models.set(key, await make(d)) } catch (e) { if (d !== 'webgpu') throw e; console.warn('webgpu load failed', e); models.set(key, await make('wasm')) } }
  return models.get(key)
}
async function guarded<R>(f: () => Promise<R>): Promise<R> {
  try { return await f() } catch (e) {
    if (forceWasm || (await device()) !== 'webgpu') throw e
    console.warn('WebGPU run failed, switching to WASM', e); forceWasm = true; models.clear(); return await f()
  }
}
const toRaw = (d: Img) => new T.RawImage(d.data, d.w, d.h, 4)

// ---- background removal (BiRefNet-lite) ----
async function bgRemove(img: Img) {
  const { AutoModel, AutoProcessor } = await libs()
  // WebGPU: BiRefNet-lite (best quality). WASM (no GPU): RMBG-1.4 int8 — BiRefNet runs out of WASM memory.
  const d = await device()
  if (d === 'webgpu') {
    const m = await model('bg', async (dv) => ({
      proc: await AutoProcessor.from_pretrained(BG_REPO, { progress_callback: progress }),
      net: await AutoModel.from_pretrained(BG_REPO, { device: dv as any, dtype: 'fp16' as any, progress_callback: progress }),
    }))
    post({ type: 'status', text: 'Удаляю фон…' })
    const { pixel_values } = await m.proc(toRaw(img)), out = await m.net({ input_image: pixel_values })
    return maskFrom((out.output_image || Object.values(out)[0]) as any, img, true)
  }
  const m = await model('rmbg', async (dv) => ({
    proc: await AutoProcessor.from_pretrained(RMBG_REPO, { progress_callback: progress, config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255, size: { width: 1024, height: 1024 } } as any }),
    net: await AutoModel.from_pretrained(RMBG_REPO, { device: dv as any, dtype: 'q8' as any, progress_callback: progress, config: { model_type: 'custom' } as any }),
  }))
  post({ type: 'status', text: 'Удаляю фон…' })
  const { pixel_values } = await m.proc(toRaw(img)), { output } = await m.net({ input: pixel_values })
  return maskFrom(output, img, false)
}
async function maskFrom(t: any, img: Img, logits: boolean) {
  const src = t.data as Float32Array, n = src.length, u8 = new Uint8ClampedArray(n)
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < n; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v }
  const sig = logits && (mn < -0.01 || mx > 1.01), span = !logits ? Math.max(1e-6, mx - mn) : 1
  for (let i = 0; i < n; i++) { const v = sig ? 1 / (1 + Math.exp(-src[i])) : logits ? src[i] : (src[i] - mn) / span; u8[i] = v * 255 }
  const s = Math.round(Math.sqrt(n)), mask = await new T.RawImage(u8, s, s, 1).resize(img.w, img.h)
  return { w: mask.width, h: mask.height, alpha: new Uint8ClampedArray(mask.data) }
}

// ---- segment anything (SlimSAM) ----
let emb: { key: string; e: any; inputs: any } | null = null
async function segment(img: Img, key: string, pts: number[][]) {
  const { AutoProcessor, SamModel, Tensor } = await libs()
  const m = await model('sam', async (d) => ({
    proc: await AutoProcessor.from_pretrained(SAM_REPO, { progress_callback: progress }),
    net: await SamModel.from_pretrained(SAM_REPO, { device: d as any, dtype: 'q8' as any, progress_callback: progress }),
  }))
  if (!emb || emb.key !== key) { post({ type: 'status', text: 'Изучаю фото…' }); const inputs = await m.proc(toRaw(img)); emb = { key, inputs, e: await (m.net as any).get_image_embeddings(inputs) } }
  post({ type: 'status', text: 'Выделяю…' })
  const [rh, rw] = emb.inputs.reshaped_input_sizes[0]
  const input_points = new Tensor('float32', pts.flatMap(p => [p[0] * rw, p[1] * rh]), [1, 1, pts.length, 2])
  const input_labels = new Tensor('int64', new BigInt64Array(pts.map(p => BigInt(p[2] ?? 1))), [1, 1, pts.length])
  const out = await m.net({ ...emb.e, input_points, input_labels })
  const masks = await (m.proc as any).post_process_masks(out.pred_masks, emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes)
  const mk = masks[0], scores = out.iou_scores.data as Float32Array
  let best = 0; for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
  const [, , H, W] = mk.dims, n = W * H, a = new Uint8ClampedArray(n), src = mk.data
  for (let i = 0; i < n; i++) a[i] = src[best * n + i] ? 255 : 0
  return { w: W, h: H, alpha: a }
}

// ---- inpainting: LaMa (quality, 512×512) or MI-GAN (fast) ----
async function cachedBytes(url: string) {
  const c = await caches.open('local-editor-models'); let r = await c.match(url)
  if (!r) {
    const res = await fetch(url); if (!res.ok || !res.body) throw new Error('download ' + res.status)
    const total = +(res.headers.get('content-length') || 0), rd = res.body.getReader(), parts: Uint8Array[] = []; let l = 0
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); l += value.length; if (total) post({ type: 'progress', loaded: l, total }) }
    const blob = new Blob(parts as BlobPart[]); await c.put(url, new Response(blob, { headers: { 'content-length': String(blob.size) } })); return new Uint8Array(await blob.arrayBuffer())
  }
  return new Uint8Array(await r.arrayBuffer())
}
async function session(key: string, url: string) {
  ort ||= await import(/* @vite-ignore */ ORT_URL)
  return model(key, async (d) => { const buf = await cachedBytes(url); return ort.InferenceSession.create(buf, { executionProviders: [d], graphOptimizationLevel: 'all' }) }) as Promise<ORT.InferenceSession>
}
async function inpaint(img: Img, mask: Uint8ClampedArray, mode: 'quality' | 'fast') {
  const { w, h, data } = img, n = w * h
  post({ type: 'status', text: 'Убираю объект…' })
  if (mode === 'quality') {
    const s = await session('lama', LAMA_URL), im = new Float32Array(3 * n), mk = new Float32Array(n)
    for (let i = 0; i < n; i++) { im[i] = data[i * 4] / 255; im[n + i] = data[i * 4 + 1] / 255; im[2 * n + i] = data[i * 4 + 2] / 255; mk[i] = mask[i] > 127 ? 1 : 0 }
    const r = await s.run({ image: new ort.Tensor('float32', im, [1, 3, h, w]), mask: new ort.Tensor('float32', mk, [1, 1, h, w]) })
    const o = (r.output || Object.values(r)[0]).data as Float32Array; let mx = 0; for (let i = 0; i < o.length; i += 97) mx = Math.max(mx, o[i])
    const k = mx <= 1.5 ? 255 : 1, out = new Uint8ClampedArray(4 * n)
    for (let i = 0; i < n; i++) { out[i * 4] = o[i] * k; out[i * 4 + 1] = o[n + i] * k; out[i * 4 + 2] = o[2 * n + i] * k; out[i * 4 + 3] = 255 }
    return { w, h, data: out }
  }
  const s = await session('migan', MIGAN_URL), chw = new Uint8Array(3 * n), m = new Uint8Array(n)
  for (let i = 0; i < n; i++) { chw[i] = data[i * 4]; chw[n + i] = data[i * 4 + 1]; chw[2 * n + i] = data[i * 4 + 2]; m[i] = mask[i] > 127 ? 0 : 255 }
  const r = await s.run({ image: new ort.Tensor('uint8', chw, [1, 3, h, w]), mask: new ort.Tensor('uint8', m, [1, 1, h, w]) })
  const o = r.result.data as Uint8Array, out = new Uint8ClampedArray(4 * n)
  for (let i = 0; i < n; i++) { out[i * 4] = o[i]; out[i * 4 + 1] = o[n + i]; out[i * 4 + 2] = o[2 * n + i]; out[i * 4 + 3] = 255 }
  return { w, h, data: out }
}

// ---- upscale (Swin2SR): fixed-size tiles (edge-padded) so every run has the same shape ----
async function upscale(img: Img, scale: 2 | 4) {
  const { pipeline } = await libs()
  const p = await model('up' + scale, (d) => pipeline('image-to-image', UP_REPO[scale], { device: d as any, dtype: 'fp32' as any, progress_callback: progress }))
  const { w, h, data } = img, TS = 128, O = 16, B = TS + 2 * O, W = w * scale, H = h * scale, out = new Uint8ClampedArray(W * H * 4)
  const nx = Math.ceil(w / TS), ny = Math.ceil(h / TS), tile = new Uint8ClampedArray(B * B * 4), t0 = Date.now(); let k = 0
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const x0 = tx * TS, y0 = ty * TS, x1 = Math.min(w, x0 + TS), y1 = Math.min(h, y0 + TS)
    for (let y = 0; y < B; y++) { const sy = Math.min(h - 1, Math.max(0, y0 - O + y)); for (let x = 0; x < B; x++) { const sx = Math.min(w - 1, Math.max(0, x0 - O + x)), si = (sy * w + sx) * 4, di = (y * B + x) * 4; tile[di] = data[si]; tile[di + 1] = data[si + 1]; tile[di + 2] = data[si + 2]; tile[di + 3] = 255 } }
    const r: Raw = await p(new T.RawImage(tile.slice(), B, B, 4)), rc = r.channels, rw = r.width
    for (let y = 0; y < (y1 - y0) * scale; y++) for (let x = 0; x < (x1 - x0) * scale; x++) {
      const di = ((y0 * scale + y) * W + x0 * scale + x) * 4, si = ((O * scale + y) * rw + O * scale + x) * rc
      out[di] = r.data[si]; out[di + 1] = r.data[si + 1]; out[di + 2] = r.data[si + 2]; out[di + 3] = 255
    }
    k++; const el = (Date.now() - t0) / 1000
    post({ type: 'status', text: 'Увеличиваю…', frac: k / (nx * ny), eta: el / k * (nx * ny - k) })
  }
  return { w: W, h: H, data: out }
}

self.onmessage = async (e: MessageEvent) => {
  const d = e.data; id = d.id
  try {
    let r: any
    if (d.task === 'bg') r = await guarded(() => bgRemove(d.img))
    else if (d.task === 'sam') r = await guarded(() => segment(d.img, d.key, d.pts))
    else if (d.task === 'inpaint') r = await guarded(() => inpaint(d.img, d.mask, d.mode))
    else if (d.task === 'upscale') r = await guarded(() => upscale(d.img, d.scale))
    else if (d.task === 'warm') { await libs(); r = { ok: true } }
    post({ type: 'done', result: r }, r && (r.alpha || r.data) ? [(r.alpha || r.data).buffer] : [])
  } catch (err) { console.error(err); post({ type: 'error', error: String((err as any)?.message || err) }) }
}

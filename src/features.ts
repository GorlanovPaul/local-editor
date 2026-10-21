import { reactive } from 'vue'
/** On-device "smart features": what to download, where it is cached, human names. */
const HF = 'https://huggingface.co'
const tf = (repo: string, files: string[]) => files.map(f => `${HF}/${repo}/resolve/main/${f}`)
export type FeatureId = 'bg' | 'sam' | 'lama' | 'migan' | 'up2' | 'up4'
export interface Feature { id: FeatureId; name: string; desc: string; mb: number; cache: string; urls: string[]; tech: string; license: string }
import { BG_REPO, RMBG_REPO, SAM_REPO, UP_REPO, LAMA_URL, MIGAN_URL } from './models'
export { BG_REPO, SAM_REPO, UP_REPO, LAMA_URL, MIGAN_URL }
const TC = 'transformers-cache', MC = 'local-editor-models'
export const features: Feature[] = [
  { id: 'bg', name: 'Удаление фона', desc: 'Вырезает человека, животное или предмет', mb: 115, cache: TC, urls: tf(BG_REPO, ['config.json', 'preprocessor_config.json', 'onnx/model_fp16.onnx']), tech: 'BiRefNet-lite (fp16)', license: 'MIT' },
  { id: 'sam', name: 'Выделение объекта касанием', desc: 'Для перекраски, вырезания и размытия', mb: 14, cache: TC, urls: tf(SAM_REPO, ['config.json', 'preprocessor_config.json', 'onnx/vision_encoder_quantized.onnx', 'onnx/prompt_encoder_mask_decoder_quantized.onnx']), tech: 'SlimSAM-77 (int8)', license: 'Apache-2.0' },
  { id: 'lama', name: 'Удаление объектов — качество', desc: 'Лучше восстанавливает фон', mb: 93, cache: MC, urls: [LAMA_URL], tech: 'LaMa (OpenCV Zoo, 2025)', license: 'Apache-2.0' },
  { id: 'migan', name: 'Удаление объектов — быстро', desc: 'Быстрее и легче, но проще результат', mb: 28, cache: MC, urls: [MIGAN_URL], tech: 'MI-GAN', license: 'MIT' },
  { id: 'up2', name: 'Увеличение ×2', desc: 'Повышает чёткость и размер', mb: 55, cache: TC, urls: tf(UP_REPO[2], ['config.json', 'preprocessor_config.json', 'onnx/model.onnx']), tech: 'Swin2SR classical ×2 (fp32)', license: 'Apache-2.0' },
  { id: 'up4', name: 'Увеличение ×4', desc: 'Для маленьких и сжатых фото', mb: 55, cache: TC, urls: tf(UP_REPO[4], ['config.json', 'preprocessor_config.json', 'onnx/model.onnx']), tech: 'Swin2SR compressed ×4 (fp32)', license: 'Apache-2.0' },
]
export const feature = (id: FeatureId) => features.find(f => f.id === id)!

export const settings = reactive({ inpaint: (localStorage.getItem('le.inpaint') as 'quality' | 'fast') || 'quality' })
export function setInpaint(v: 'quality' | 'fast') { settings.inpaint = v; localStorage.setItem('le.inpaint', v) }

/** WebGPU → best background model; otherwise a lighter one that fits in CPU memory */
let gpuP: Promise<boolean> | null = null
export function hasGpu() { return gpuP ||= (async () => { try { return !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter()) } catch { return false } })() }
const ready0 = hasGpu().then(g => { if (!g) Object.assign(feature('bg'), { mb: 44, urls: tf(RMBG_REPO, ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']), tech: 'RMBG-1.4 int8 (без WebGPU; BiRefNet не помещается в память CPU)', license: 'BRIA RMBG-1.4 (некоммерческая)' }) })
export const status = reactive<Record<string, { ready: boolean; frac?: number; bytes: number }>>({})
export async function refresh(id?: FeatureId) {
  await ready0
  for (const f of id ? [feature(id)] : features) {
    let ok = true, bytes = 0
    try { const c = await caches.open(f.cache); for (const u of f.urls) { const r = await c.match(u); if (!r) { ok = false; continue } bytes += +(r.headers.get('content-length') || 0) || (u.endsWith('.onnx') ? f.mb * 1e6 : 0) } } catch { ok = false }
    status[f.id] = { ...(status[f.id] || {}), ready: ok, bytes }
  }
}
export const isReady = async (id: FeatureId) => { await refresh(id); return !!status[id]?.ready }
const downloading = new Map<FeatureId, Promise<void>>()
export function download(id: FeatureId, onP?: (f: number) => void): Promise<void> {
  if (downloading.has(id)) return downloading.get(id)!
  const p = (async () => {
    await ready0
    const f = feature(id), c = await caches.open(f.cache)
    const sizes = f.urls.map(u => u.endsWith('.onnx') ? f.mb * 1e6 : 2e3), tot = sizes.reduce((a, b) => a + b, 0); let done = 0
    for (let i = 0; i < f.urls.length; i++) {
      const u = f.urls[i]; if (await c.match(u)) { done += sizes[i]; continue }
      const res = await fetch(u); if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
      const len = +(res.headers.get('content-length') || 0) || sizes[i], rd = res.body.getReader(), parts: Uint8Array[] = []; let l = 0
      for (;;) { const { done: d, value } = await rd.read(); if (d) break; parts.push(value); l += value.length; const fr = Math.min(0.999, (done + l / len * sizes[i]) / tot); status[id] = { ready: false, frac: fr, bytes: 0 }; onP?.(fr) }
      const blob = new Blob(parts as BlobPart[])
      await c.put(u, new Response(blob, { headers: { 'content-length': String(blob.size), 'content-type': res.headers.get('content-type') || 'application/octet-stream' } }))
      done += sizes[i]
    }
    try { await navigator.storage?.persist?.() } catch { /* ignore */ }
    await refresh(id)
  })().finally(() => downloading.delete(id))
  downloading.set(id, p); return p
}
export async function remove(id: FeatureId) { const f = feature(id), c = await caches.open(f.cache); for (const u of f.urls) await c.delete(u); await refresh(id) }
export async function removeAll() { for (const f of features) await remove(f.id); await caches.delete('local-editor-runtime') }
export const onMetered = () => { const c = (navigator as any).connection; return !!c && (c.saveData || (c.type && c.type !== 'wifi' && c.type !== 'ethernet' && c.type !== 'unknown')) }
export const fmtMB = (b: number) => b >= 1e9 ? (b / 1e9).toFixed(1) + ' ГБ' : Math.round(b / 1e6) + ' МБ'

import { canvas, alphaBox, toBlob } from './image'
export interface StickerOpts { outline: number; color: string; shadow: number; caption?: string; captionColor?: string; size?: number }
export const defaultSticker = (): StickerOpts => ({ outline: 6, color: '#ffffff', shadow: 40, caption: '', captionColor: '#ffffff' })

/** silhouette outline + soft shadow around a transparent image; returns new canvas with padding */
export function outlined(src: HTMLCanvasElement, o: StickerOpts, scale = 1) {
  const r = Math.round(o.outline * scale), pad = r + Math.round(o.shadow / 100 * 24 * scale) + 2
  const c = canvas(src.width + pad * 2, src.height + pad * 2), x = c.getContext('2d')!
  if (r > 0) {
    const sil = canvas(c.width, c.height), sx = sil.getContext('2d')!
    const steps = Math.max(16, r * 3)
    const th = canvas(src.width, src.height), tx = th.getContext('2d', { willReadFrequently: true })!; tx.drawImage(src, 0, 0)
    const id = tx.getImageData(0, 0, th.width, th.height), d = id.data
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 110 ? 0 : 255
    tx.putImageData(id, 0, 0)
    for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; sx.drawImage(th, pad + Math.cos(a) * r, pad + Math.sin(a) * r) }
    sx.drawImage(th, pad, pad)
    sx.globalCompositeOperation = 'source-in'; sx.fillStyle = o.color; sx.fillRect(0, 0, c.width, c.height)
    if (o.shadow) { x.save(); x.shadowColor = `rgba(0,0,0,${0.15 + o.shadow / 100 * 0.35})`; x.shadowBlur = o.shadow / 100 * 18 * scale; x.shadowOffsetY = o.shadow / 100 * 5 * scale; x.drawImage(sil, 0, 0); x.restore() }
    else x.drawImage(sil, 0, 0)
  } else if (o.shadow) { x.save(); x.shadowColor = `rgba(0,0,0,${0.2 + o.shadow / 100 * 0.35})`; x.shadowBlur = o.shadow / 100 * 18 * scale; x.drawImage(src, pad, pad); x.restore() }
  x.drawImage(src, pad, pad)
  return c
}

/** Telegram static sticker: one side exactly 512, other ≤512, transparent, ≤512 KB */
export function makeSticker(cut: HTMLCanvasElement, o: StickerOpts, side = 512) {
  const b = alphaBox(cut), t = canvas(b.w, b.h); t.getContext('2d')!.drawImage(cut, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  // scale content so the final (with outline) fits `side`
  const margin = side * 0.04, capH = o.caption ? side * 0.2 : 0
  const s0 = Math.min((side - 2 * margin) / b.w, (side - 2 * margin - capH) / b.h)
  const sc = canvas(b.w * s0, b.h * s0), sx = sc.getContext('2d')!; sx.imageSmoothingQuality = 'high'; sx.drawImage(t, 0, 0, sc.width, sc.height)
  const ol = outlined(sc, o, side / 512)
  const k = Math.min(side / ol.width, (side - capH) / ol.height)
  const W = ol.width * k, H = ol.height * k + capH
  const f = Math.min(side / W, side / H) // ensure one side == side
  const out = canvas(W * f, H * f), x = out.getContext('2d')!; x.imageSmoothingQuality = 'high'
  x.drawImage(ol, (out.width - ol.width * k * f) / 2, 0, ol.width * k * f, ol.height * k * f)
  if (o.caption) {
    const px = capH * f * 0.62; x.font = `800 ${px}px system-ui, -apple-system, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'
    let fs = px; while (x.measureText(o.caption).width > out.width * 0.94 && fs > 10) { fs -= 2; x.font = `800 ${fs}px system-ui, sans-serif` }
    const cy = out.height - capH * f / 2; x.lineJoin = 'round'; x.lineWidth = fs * 0.22; x.strokeStyle = o.captionColor === '#000000' ? '#fff' : '#000'
    x.strokeText(o.caption, out.width / 2, cy); x.fillStyle = o.captionColor || '#fff'; x.fillText(o.caption, out.width / 2, cy)
  }
  return out
}
/** encode under a size limit, lowering WebP quality if needed */
export async function encodeLimited(c: HTMLCanvasElement, type: 'image/webp' | 'image/png', limit = 512 * 1024) {
  if (type === 'image/png') { const b = await toBlob(c, 'image/png'); if (b.size <= limit) return b; type = 'image/webp' }
  for (let q = 0.95; q > 0.3; q -= 0.1) { const b = await toBlob(c, type, q); if (b.size <= limit) return b }
  return toBlob(c, type, 0.3)
}
export function icon100(c: HTMLCanvasElement) {
  const o = canvas(100, 100), x = o.getContext('2d')!, s = Math.min(100 / c.width, 100 / c.height)
  x.imageSmoothingQuality = 'high'; x.drawImage(c, (100 - c.width * s) / 2, (100 - c.height * s) / 2, c.width * s, c.height * s); return o
}

import type { EditState, Item, Stroke } from './state'
export interface Box { id: string; cx: number; cy: number; hw: number; hh: number; rot: number }
let scratch: HTMLCanvasElement | null = null

export function drawStroke(x: CanvasRenderingContext2D, s: Stroke, W: number, H: number) {
  x.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
  x.strokeStyle = s.color; x.fillStyle = s.color; x.lineWidth = s.width * W; x.lineCap = 'round'; x.lineJoin = 'round'
  const p = s.pts
  if (p.length === 2) { x.beginPath(); x.arc(p[0] * W, p[1] * H, x.lineWidth / 2, 0, 7); x.fill(); return }
  x.beginPath(); x.moveTo(p[0] * W, p[1] * H)
  for (let i = 2; i < p.length - 2; i += 2) { const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2; x.quadraticCurveTo(p[i] * W, p[i + 1] * H, mx * W, my * H) }
  x.lineTo(p[p.length - 2] * W, p[p.length - 1] * H); x.stroke()
}

function itemFont(it: Item, W: number) { const px = it.size * W; return { px, font: it.type === 'text' ? `700 ${px}px ${it.font}` : `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif` } }

export function drawOverlays(ctx: CanvasRenderingContext2D, W: number, H: number, st: EditState, extra?: Stroke | null, sel?: string | null, exporting = false): Box[] {
  const boxes: Box[] = []
  const strokes = extra ? [...st.strokes, extra] : st.strokes
  if (strokes.length) {
    scratch ||= document.createElement('canvas')
    scratch.width = W; scratch.height = H
    const x = scratch.getContext('2d')!
    for (const s of strokes) drawStroke(x, s, W, H)
    x.globalCompositeOperation = 'source-over'; ctx.drawImage(scratch, 0, 0)
  }
  for (const it of st.items) {
    const { px, font } = itemFont(it, W); ctx.save(); ctx.translate(it.x * W, it.y * H); ctx.rotate(it.rot)
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const lines = it.text.split('\n'), lh = px * 1.15
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width), px * 0.5), th = lh * lines.length
    if (it.type === 'text' && it.bg) { ctx.fillStyle = it.color === '#000000' ? '#ffffffd0' : '#000000a0'; rr(ctx, -tw / 2 - px * 0.3, -th / 2 - px * 0.15, tw + px * 0.6, th + px * 0.3, px * 0.25); ctx.fill() }
    lines.forEach((l, i) => {
      const y = (i - (lines.length - 1) / 2) * lh
      if (it.type === 'text') {
        if (!it.bg) { ctx.lineWidth = px * 0.08; ctx.strokeStyle = it.color === '#000000' ? '#fff8' : '#0006'; ctx.lineJoin = 'round'; ctx.strokeText(l, 0, y) }
        ctx.fillStyle = it.color
      } else ctx.fillStyle = '#000'
      ctx.fillText(l, 0, y)
    })
    if (sel === it.id) { ctx.setLineDash([px * 0.15, px * 0.1]); ctx.lineWidth = Math.max(2, W / 400); ctx.strokeStyle = '#fff'; ctx.strokeRect(-tw / 2 - px * 0.35, -th / 2 - px * 0.2, tw + px * 0.7, th + px * 0.4) }
    ctx.restore()
    boxes.push({ id: it.id, cx: it.x * W, cy: it.y * H, hw: tw / 2 + px * 0.35, hh: th / 2 + px * 0.2, rot: it.rot })
  }
  drawFrame(ctx, W, H, st, exporting)
  return boxes
}
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
}
function drawFrame(c: CanvasRenderingContext2D, W: number, H: number, st: EditState, exporting: boolean) {
  const f = st.frame; if (f.kind === 'none') return
  const m = Math.min(W, H), t = m * (0.01 + f.size / 100 * 0.12)
  if (f.kind === 'circle') {
    const R = m / 2
    c.save()
    if (f.color) { c.fillStyle = f.color; c.beginPath(); c.rect(0, 0, W, H); c.arc(W / 2, H / 2, R, 0, Math.PI * 2); c.fill('evenodd') }
    else if (exporting) { c.globalCompositeOperation = 'destination-in'; c.beginPath(); c.arc(W / 2, H / 2, R, 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'source-over' }
    if (f.size > 0) { c.strokeStyle = f.color && f.color !== '#ffffff' ? '#ffffff' : '#ffffff'; c.lineWidth = m * f.size / 100 * 0.06; c.beginPath(); c.arc(W / 2, H / 2, R - c.lineWidth / 2, 0, Math.PI * 2); c.stroke() }
    c.restore(); return
  }
  if (f.kind === 'rounded' && !f.color) { if (exporting) { c.save(); c.globalCompositeOperation = 'destination-in'; rr(c, 0, 0, W, H, m * 0.18); c.fill(); c.restore() } return }
  c.save(); c.fillStyle = f.color || '#ffffff'; c.strokeStyle = f.color || '#ffffff'
  if (f.kind === 'border' || f.kind === 'polaroid') {
    const b = f.kind === 'polaroid' ? t * 3.5 : t
    c.beginPath(); c.rect(0, 0, W, H); c.rect(t, t, W - 2 * t, H - t - b); c.fill('evenodd')
  } else if (f.kind === 'rounded') {
    c.beginPath(); c.rect(0, 0, W, H); rr(c, 0, 0, W, H, t * 2.5); c.fill('evenodd')
  } else if (f.kind === 'line') {
    c.lineWidth = Math.max(1, t * 0.15); c.strokeRect(t, t, W - 2 * t, H - 2 * t)
  } else if (f.kind === 'film') {
    const b = t * 1.6; c.fillStyle = '#111'; c.beginPath(); c.rect(0, 0, W, H); c.rect(0, b, W, H - 2 * b); c.fill('evenodd')
    c.fillStyle = '#eee'; const hw = b * 0.45, gap = hw * 1.8
    for (let x = gap / 2; x < W; x += gap) { rr(c, x, b * 0.3, hw, b * 0.4, hw * 0.2); c.fill(); rr(c, x, H - b * 0.7, hw, b * 0.4, hw * 0.2); c.fill() }
  }
  c.restore()
}
export function hit(boxes: Box[], x: number, y: number) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i], dx = x - b.cx, dy = y - b.cy, c = Math.cos(-b.rot), s = Math.sin(-b.rot)
    const lx = dx * c - dy * s, ly = dx * s + dy * c
    if (Math.abs(lx) <= b.hw * 1.1 && Math.abs(ly) <= b.hh * 1.3) return b.id
  }
  return null
}

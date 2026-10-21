export interface Adjust { brightness: number; contrast: number; saturation: number; blur: number; preset: 'none' | 'grayscale' | 'sepia' }
export type Job =
  | { kind: 'adjust'; a: Adjust }
  | { kind: 'crop'; x: number; y: number; w: number; h: number }
  | { kind: 'rotate'; dir: 1 | -1 }
  | { kind: 'flip'; axis: 'h' | 'v' }
  | { kind: 'export'; w: number; h: number; type: string; quality: number }
type Cv = OffscreenCanvas | HTMLCanvasElement
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
export async function process(src: CanvasImageSource & { width: number; height: number }, job: Job, mk: (w: number, h: number) => Cv): Promise<Cv> {
  const W = src.width, H = src.height
  let c: Cv, x: Ctx
  const make = (w: number, h: number) => { c = mk(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); x = c.getContext('2d') as Ctx }
  switch (job.kind) {
    case 'crop': make(job.w, job.h); x!.drawImage(src, -job.x, -job.y); break
    case 'rotate': make(H, W); x!.translate(job.dir > 0 ? H : 0, job.dir > 0 ? 0 : W); x!.rotate(job.dir * Math.PI / 2); x!.drawImage(src, 0, 0); break
    case 'flip': make(W, H); if (job.axis === 'h') { x!.translate(W, 0); x!.scale(-1, 1) } else { x!.translate(0, H); x!.scale(1, -1) } x!.drawImage(src, 0, 0); break
    case 'export': make(job.w, job.h); x!.imageSmoothingQuality = 'high'
      if (job.type === 'image/jpeg') { x!.fillStyle = '#fff'; x!.fillRect(0, 0, job.w, job.h) }
      x!.drawImage(src, 0, 0, job.w, job.h); break
    case 'adjust': {
      make(W, H); const a = job.a
      const filterOk = 'filter' in x! && a.blur > 0
      if (filterOk) x!.filter = `blur(${a.blur}px)`
      x!.drawImage(src, 0, 0)
      if (filterOk) x!.filter = 'none'
      else if (a.blur > 0) boxBlur(x!, W, H, Math.round(a.blur))
      pixelAdjust(x!, W, H, a); break
    }
  }
  return c!
}
function pixelAdjust(x: Ctx, W: number, H: number, a: Adjust) {
  if (a.brightness === 100 && a.contrast === 100 && a.saturation === 100 && a.preset === 'none') return
  const img = x.getImageData(0, 0, W, H), d = img.data
  const b = a.brightness / 100, ct = a.contrast / 100, s = a.saturation / 100
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * b, g = d[i + 1] * b, bl = d[i + 2] * b
    r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; bl = (bl - 128) * ct + 128
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl
    r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s
    if (a.preset === 'grayscale') { r = g = bl = 0.2126 * r + 0.7152 * g + 0.0722 * bl }
    else if (a.preset === 'sepia') { const R = r, G = g, B = bl; r = .393 * R + .769 * G + .189 * B; g = .349 * R + .686 * G + .168 * B; bl = .272 * R + .534 * G + .131 * B }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl
  }
  x.putImageData(img, 0, 0)
}
function boxBlur(x: Ctx, W: number, H: number, r: number) {
  const img = x.getImageData(0, 0, W, H), d = img.data, t = new Uint8ClampedArray(d.length)
  for (let pass = 0; pass < 2; pass++) {
    const [src, dst] = pass === 0 ? [d, t] : [t, d]
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) for (let ch = 0; ch < 4; ch++) {
      let sum = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const px = pass === 0 ? xx + k : xx, py = pass === 0 ? y : y + k
        if (px < 0 || py < 0 || px >= W || py >= H) continue
        sum += src[(py * W + px) * 4 + ch]; n++
      }
      dst[(y * W + xx) * 4 + ch] = sum / n
    }
  }
  x.putImageData(img, 0, 0)
}

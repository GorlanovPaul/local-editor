export const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }
export const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((r, j) => c.toBlob(b => b ? r(b) : j(new Error('toBlob')), type, q))
/** image * mask(alpha) -> transparent cutout at image resolution */
export function cutout(img: CanvasImageSource & { width: number; height: number }, mask: HTMLCanvasElement) {
  const c = canvas(img.width, img.height), x = c.getContext('2d')!
  x.drawImage(img, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0, c.width, c.height); return c
}
/** bounding box of non-transparent pixels */
export function alphaBox(c: HTMLCanvasElement, thr = 12) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? { x: 0, y: 0, w: c.width, h: c.height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick, shallowRef, toRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { scenarios, socialPresets } from '../scenarios'
import { platform } from '../platform'
import { pending } from '../store'
import { cutout } from '../tools/image'
import { makeSticker, encodeLimited, outlined, defaultSticker } from '../tools/sticker'
import { X, Undo2, Redo2, Crop, SlidersHorizontal, Palette, WandSparkles, Type, Brush, Smile, Frame, RotateCw, FlipHorizontal2, Eraser, Plus, Trash2, ImagePlus, Camera, Eye, Share2, Scissors, Maximize2, Sparkles, Download, Pointer, History, Sticker, ChevronLeft } from 'lucide-vue-next'
import Ruler from '../components/Ruler.vue'
import { Renderer, geoMatrix, frameDims, outDims } from '../gl'
import { drawOverlays, hit, type Box } from '../overlay'
import { defaultState, adjTools, filters, aspects, frames, fonts, colors, emojis, zeroAdj, type EditState, type AdjKey, type Stroke, type Item, type TextItem } from '../state'
import { getDraft, putDraft, delDraft, type Draft } from '../db'
import { call, pixels, alphaCanvas, MODEL_SIZES } from '../ai'

const route = useRoute(), router = useRouter()
const scen = computed(() => scenarios.find(x => x.id === route.params.scenario) || scenarios[0])
const preset = computed(() => scen.value.preset || {})
const stickerOpts = reactive(defaultSticker())
const exact = ref<{ w: number; h: number } | null>(null)
const st = reactive<EditState>(defaultState())
const loaded = ref(false), fileName = ref('photo'), msg = ref(''), dragOver = ref(false)
const busy = ref<{ text: string; frac?: number } | null>(null)
type Tab = 'sticker' | 'crop' | 'adjust' | 'filters' | 'ai' | 'text' | 'draw' | 'stickers' | 'frame'
const tab = ref<Tab>('adjust')
const stickerTab = { id: 'sticker' as Tab, l: 'Стикер', i: Sticker }
const tabs: { id: Tab; l: string; i: any }[] = [
  { id: 'crop', l: 'Кадр', i: Crop }, { id: 'adjust', l: 'Настройки', i: SlidersHorizontal }, { id: 'filters', l: 'Фильтры', i: Palette },
  { id: 'ai', l: 'ИИ', i: WandSparkles }, { id: 'text', l: 'Текст', i: Type }, { id: 'draw', l: 'Рисунок', i: Brush },
  { id: 'stickers', l: 'Стикеры', i: Smile }, { id: 'frame', l: 'Рамка', i: Frame }]
const toast = (t: string, ms = 2500) => { msg.value = t; setTimeout(() => msg.value === t && (msg.value = ''), ms) }
const buzz = (n = 8) => platform.haptic(n > 12 ? 'success' : n > 7 ? 'medium' : 'light')

// ---------- images & masks (outside reactivity) ----------
const sources = new Map<number, ImageBitmap>(), previews = new Map<number, ImageBitmap>(), srcBlobs = new Map<number, Blob>()
const masks = new Map<number, HTMLCanvasElement>()
let nextId = 1
const PREVIEW = 2048
async function addSource(b: ImageBitmap, blob?: Blob) {
  const id = nextId++; sources.set(id, b); if (blob) srcBlobs.set(id, blob)
  const s = Math.min(1, PREVIEW / Math.max(b.width, b.height), (renderer?.maxTex || 4096) / Math.max(b.width, b.height))
  previews.set(id, s < 1 ? await createImageBitmap(b, { resizeWidth: Math.round(b.width * s), resizeHeight: Math.round(b.height * s), resizeQuality: 'high' }) : b)
  return id
}
const prev = () => previews.get(st.src)!
const full = () => sources.get(st.src)!
function addMask(c: HTMLCanvasElement) { const id = nextId++; masks.set(id, c); return id }
function cloneCanvas(c: HTMLCanvasElement) { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d')!.drawImage(c, 0, 0); return n }

// ---------- history ----------
let hist: string[] = [], hi = -1
const hv = ref(0) // bump to refresh computed
function commit() {
  const s = JSON.stringify(st); if (s === hist[hi]) return
  hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1; hv.value++; scheduleSave()
}
function restore(s: string) { const o = JSON.parse(s); for (const k in o) (st as any)[k] = o[k]; selItem.value = null; scheduleSave() }
const canUndo = computed(() => (hv.value, hi > 0)), canRedo = computed(() => (hv.value, hi < hist.length - 1))
function undo() { if (hi > 0) { restore(hist[--hi]); hv.value++; buzz() } }
function redo() { if (hi < hist.length - 1) { restore(hist[++hi]); hv.value++; buzz() } }

// ---------- loading ----------
async function loadFile(f: Blob, name = 'photo') {
  try {
    busy.value = { text: 'Открытие…' }
    const b = await createImageBitmap(f, { imageOrientation: 'from-image' } as any)
    await ensureRenderer()
    Object.assign(st, defaultState()); st.src = await addSource(b, f)
    fileName.value = name.replace(/\.[^.]+$/, '') || 'photo'
    hist = []; hi = -1; commit(); loaded.value = true; tab.value = 'adjust'; fitView(false); draft.value = null
    await applyPreset()
  } catch (e) { toast('Не удалось открыть изображение'); console.error(e) } finally { busy.value = null }
}
function onPick(e: Event) { const i = e.target as HTMLInputElement, f = i.files?.[0]; if (f) loadFile(f, f.name); i.value = '' }
function onDrop(e: DragEvent) { dragOver.value = false; const f = e.dataTransfer?.files[0]; if (f && f.type.startsWith('image/')) loadFile(f, f.name) }
function close() { if (loaded.value) flushSave(); router.push('/') }
async function applyPreset() {
  const p = preset.value; await nextTick()
  if (p.tab) tab.value = p.tab as Tab
  if (p.aiTool) aiTool.value = p.aiTool as AiTool
  if (p.frame) { st.frame.kind = p.frame; if (p.frameColor !== undefined) st.frame.color = p.frameColor; st.frame.size = 0 }
  if (p.aspect) setAspect(p.aspect)
  if (p.export) Object.assign(ex, { size: p.export.size ?? ex.size, type: p.export.type ?? ex.type })
  if (p.sticker) { st.frame.kind = 'none' }
  commit()
  if (p.auto === 'bg') await removeBg()
  else if (p.auto === 'enhance') autoEnhance()
}
function setSocial(sp: { w: number; h: number }) { exact.value = { w: sp.w, h: sp.h }; setAspect(`${sp.w}:${sp.h}`) }

// ---------- draft (IndexedDB) ----------
const draft = shallowRef<Draft | null>(null)
let saveT: any
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(flushSave, 1000) }
async function flushSave() {
  clearTimeout(saveT); if (!loaded.value || !st.src) return
  let blob = srcBlobs.get(st.src)
  if (!blob) { blob = await toBlob(bitmapCanvas(full()), 'image/png'); srcBlobs.set(st.src, blob) }
  const mk: [number, Blob][] = []
  for (const id of [st.bg.ver, st.recolor.mask]) { const m = id && masks.get(id); if (m) mk.push([id, await toBlob(m, 'image/png')]) }
  const t = document.createElement('canvas'), s = 160 / Math.max(glc.value!.width, glc.value!.height)
  t.width = glc.value!.width * s; t.height = glc.value!.height * s; t.getContext('2d')!.drawImage(glc.value!, 0, 0, t.width, t.height)
  const state = JSON.parse(JSON.stringify(st)); state.src = 0
  await putDraft({ blob, name: fileName.value, state: JSON.stringify(state), thumb: t.toDataURL('image/jpeg', 0.7), savedAt: Date.now(), masks: mk } as any)
}
async function resume() {
  const d = draft.value as any; if (!d) return
  await loadFile(d.blob, d.name)
  for (const [id, b] of d.masks || []) { const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d')!.drawImage(bm, 0, 0); masks.set(id, c); nextId = Math.max(nextId, id + 1) }
  const s = JSON.parse(d.state); s.src = st.src; Object.assign(st, s); hist = []; hi = -1; commit(); toast('Черновик восстановлен')
}
async function discardDraft() { await delDraft(); draft.value = null }
const bitmapCanvas = (b: CanvasImageSource & { width: number; height: number }) => { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; c.getContext('2d')!.drawImage(b, 0, 0); return c }
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((r, j) => c.toBlob(b => b ? r(b) : j(new Error('toBlob')), type, q))

// ---------- rendering ----------
const ulc = ref<HTMLCanvasElement>(), glc = ref<HTMLCanvasElement>(), ovc = ref<HTMLCanvasElement>(), stage = ref<HTMLDivElement>()
let renderer: Renderer | null = null, boxes: Box[] = []
const out = reactive({ w: 1, h: 1 })
const comparing = ref(false)
let curStroke: Stroke | null = null
const brushMask = shallowRef<HTMLCanvasElement | null>(null) // inpaint brush / selection preview (source coords)
async function ensureRenderer() {
  if (renderer) return
  loaded.value = true; await nextTick()
  try { renderer = new Renderer(glc.value!) } catch (e) { loaded.value = false; toast('Ваш браузер не поддерживает WebGL'); throw e }
}
let raf = 0
function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() }) }
function draw() {
  const r = renderer; if (!r || !st.src || !prev()) return
  if (r.srcId !== st.src) { const p = prev(); r.setSource(p, p.width, p.height); r.srcId = st.src }
  if (r.maskId !== st.bg.ver) { r.setMask(masks.get(st.bg.ver) || null); r.maskId = st.bg.ver }
  const selCanvas = showBrushMask.value ? brushMask.value : masks.get(st.recolor.mask) || null
  const selKey = showBrushMask.value ? -2 : st.recolor.mask
  if (r.selId !== selKey || selKey === -2) { r.setSel(selCanvas); r.selId = selKey }
  const d = r.render(st, { noCrop: tab.value === 'crop', original: comparing.value, showSel: showBrushMask.value && !comparing.value })
  if (out.w !== d.w || out.h !== d.h) { out.w = d.w; out.h = d.h }
  const o = ovc.value!; if (o.width !== d.w) o.width = d.w; if (o.height !== d.h) o.height = d.h
  const x = o.getContext('2d')!; x.clearRect(0, 0, d.w, d.h)
  if (preset.value.sticker) scheduleUnder()
  if (tab.value !== 'crop' && !comparing.value) boxes = drawOverlays(x, d.w, d.h, st, curStroke, tab.value === 'text' || tab.value === 'stickers' ? selItem.value : null)
}
watch(st, scheduleRender, { deep: true })
let underT: any
function scheduleUnder() { clearTimeout(underT); underT = setTimeout(drawUnder, 60) }
function drawUnder() {
  const u = ulc.value, gc = glc.value; if (!u || !gc) return
  const x = u.getContext('2d')!; u.width = gc.width; u.height = gc.height
  if (!preset.value.sticker || comparing.value || tab.value === 'crop') return
  const k = Math.max(gc.width, gc.height) / 512, ol = outlined(gc, { ...stickerOpts }, k), pad = (ol.width - gc.width) / 2
  x.drawImage(ol, -pad, -pad)
}
watch(stickerOpts, scheduleUnder, { deep: true })
watch([tab, comparing], () => { scheduleRender(); if (tab.value !== 'stickers' && tab.value !== 'text') selItem.value = null })

// ---------- view: zoom & pan ----------
const view = reactive({ z: 1, tx: 0, ty: 0, anim: false })
const stageSize = reactive({ w: 1, h: 1 })
const disp = computed(() => {
  const pad = tab.value === 'crop' ? 28 : 8, aw = stageSize.w - pad * 2, ah = stageSize.h - pad * 2, s = Math.min(aw / out.w, ah / out.h)
  return { w: out.w * s, h: out.h * s }
})
const zoom100 = computed(() => { const f = sources.get(st.src); return f ? Math.max(2, (outDims(st.geo, f.width, f.height).w / (window.devicePixelRatio || 1)) / disp.value.w) : 2 })
function clampView() {
  const mx = Math.max(0, (disp.value.w * view.z - stageSize.w) / 2 + 40), my = Math.max(0, (disp.value.h * view.z - stageSize.h) / 2 + 40)
  if (view.z <= 1) { view.tx = 0; view.ty = 0 } else { view.tx = Math.max(-mx, Math.min(mx, view.tx)); view.ty = Math.max(-my, Math.min(my, view.ty)) }
}
function zoomAt(nz: number, cx: number, cy: number) {
  nz = Math.max(1, Math.min(Math.max(10, zoom100.value * 2), nz))
  const r = stage.value!.getBoundingClientRect(), px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2
  view.tx = px - (px - view.tx) * nz / view.z; view.ty = py - (py - view.ty) * nz / view.z; view.z = nz
}
function fitView(anim = true) { view.anim = anim; view.z = 1; view.tx = 0; view.ty = 0 }
const zoomLabel = ref(''); let zlT: any
watch(() => view.z, (z) => { zoomLabel.value = z > 1.01 ? Math.round(z * 100) + '%' : ''; clearTimeout(zlT); zlT = setTimeout(() => zoomLabel.value = '', 900) })
function onWheel(e: WheelEvent) { e.preventDefault(); view.anim = false; zoomAt(view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY); clampView() }

// ---------- pointers ----------
const pts = new Map<number, { x: number; y: number }>()
type G = { kind: 'none' | 'pan' | 'pinch' | 'crop' | 'item' | 'stroke' | 'mask' | 'tap'; [k: string]: any }
let g: G = { kind: 'none' }, lastTap = 0, holdT: any
const selItem = ref<string | null>(null)
function norm(cx: number, cy: number) { const r = ovc.value!.getBoundingClientRect(); return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height, rw: r.width, rh: r.height } }
function toSrc(nx: number, ny: number) { const p = prev(), m = geoMatrix(st.geo, p.width, p.height, tab.value === 'crop'); return { x: m[0] * nx + m[2] * ny + m[4], y: m[1] * nx + m[3] * ny + m[5] } }
const showBrushMask = computed(() => tab.value === 'ai' && (aiTool.value === 'erase' || aiTool.value === 'obj') && !!brushMask.value)
function pdown(e: PointerEvent) {
  if (!loaded.value || busy.value) return
  stage.value!.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); view.anim = false
  if (pts.size === 2) {
    cancelSingle()
    const [a, b] = [...pts.values()], it = selItem.value ? st.items.find(i => i.id === selItem.value) : null
    g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z: view.z, tx: view.tx, ty: view.ty, it, s0: it?.size, r0: it?.rot }
    return
  }
  if (pts.size > 2) return
  const h = (e.target as HTMLElement).dataset?.h, n = norm(e.clientX, e.clientY)
  g = { kind: 'tap', sx: e.clientX, sy: e.clientY, t: Date.now(), tx: view.tx, ty: view.ty }
  if (tab.value === 'crop' && h) { g = { kind: 'crop', mode: h, sx: e.clientX, sy: e.clientY, o: { ...st.geo.crop }, rw: n.rw, rh: n.rh }; return }
  if (tab.value === 'draw') { curStroke = { color: brush.color, width: brush.size / 100 * 0.08, erase: brush.erase, pts: [n.x, n.y] }; g = { kind: 'stroke' }; scheduleRender(); return }
  if (tab.value === 'ai' && (aiTool.value === 'erase' || (aiTool.value === 'bg' && bgBrush.value !== 'off' && st.bg.ver))) { startMask(n); return }
  if (tab.value === 'text' || tab.value === 'stickers') {
    const id = hit(boxes, n.x * out.w, n.y * out.h)
    if (id) { selItem.value = id; const it = st.items.find(i => i.id === id)!; g = { kind: 'item', it, ox: it.x, oy: it.y, sx: e.clientX, sy: e.clientY, rw: n.rw, rh: n.rh, moved: false }; scheduleRender(); return }
  }
  if (tab.value === 'adjust' || tab.value === 'filters' || (tab.value === 'ai' && aiTool.value === 'bg')) holdT = setTimeout(() => { if (g.kind === 'tap') { comparing.value = true; buzz(); g.hold = true } }, 450)
}
function pmove(e: PointerEvent) {
  if (!pts.has(e.pointerId)) return
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (g.kind === 'pinch' && pts.size >= 2) {
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    if (g.it) { g.it.size = Math.max(0.02, Math.min(1.5, g.s0 * d / g.d0)); g.it.rot = g.r0 + Math.atan2(b.y - a.y, b.x - a.x) - g.a0; return }
    view.z = g.z; view.tx = g.tx + (mx - g.mx); view.ty = g.ty + (my - g.my); zoomAt(g.z * d / g.d0, mx, my); return
  }
  const n = norm(e.clientX, e.clientY)
  if (g.kind === 'tap' || g.kind === 'pan') {
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy
    if (g.kind === 'tap' && Math.hypot(dx, dy) > 8) { clearTimeout(holdT); if (!g.hold) g.kind = 'pan' }
    if (g.kind === 'pan' && view.z > 1) { view.tx = g.tx + dx; view.ty = g.ty + dy; clampView() }
  } else if (g.kind === 'stroke' && curStroke) { const p = curStroke.pts; if (Math.hypot((n.x - p[p.length - 2]) * n.rw, (n.y - p[p.length - 1]) * n.rh) > 2) { p.push(n.x, n.y); scheduleRender() } }
  else if (g.kind === 'mask') moveMask(n)
  else if (g.kind === 'item') { g.moved = true; g.it.x = g.ox + (e.clientX - g.sx) / g.rw; g.it.y = g.oy + (e.clientY - g.sy) / g.rh }
  else if (g.kind === 'crop') cropMove(e)
}
function pup(e: PointerEvent) {
  if (!pts.delete(e.pointerId)) return
  clearTimeout(holdT)
  if (g.kind === 'pinch') { if (pts.size === 0) { const wasItem = !!g.it; g = { kind: 'none' }; view.anim = true; clampView(); if (wasItem) commit() } return }
  if (g.kind === 'tap') {
    if (g.hold) { comparing.value = false } else {
      const now = Date.now(), n = norm(e.clientX, e.clientY)
      if (tab.value === 'ai' && aiTool.value === 'obj') samTap(n)
      else if (tab.value === 'text' || tab.value === 'stickers') { selItem.value = null; scheduleRender() }
      if (now - lastTap < 300 && !(tab.value === 'ai' && aiTool.value === 'obj')) { view.anim = true; if (view.z > 1.05) fitView(); else zoomAt(zoom100.value, e.clientX, e.clientY); clampView(); lastTap = 0 } else lastTap = now
    }
  } else if (g.kind === 'stroke' && curStroke) { st.strokes.push(curStroke); curStroke = null; commit() }
  else if (g.kind === 'mask') endMask()
  else if (g.kind === 'item' || g.kind === 'crop') commit()
  if (g.kind === 'pan') { view.anim = true; clampView() }
  comparing.value = false
  g = { kind: 'none' }
}
function cancelSingle() { clearTimeout(holdT); if (g.kind === 'stroke') { curStroke = null; scheduleRender() } if (g.kind === 'crop') Object.assign(st.geo.crop, g.o); if (g.kind === 'mask') endMask() }

// ---------- crop ----------
const frame = computed(() => { const p = previews.get(st.src); return p ? frameDims(st.geo, p.width, p.height) : { w: 1, h: 1 } })
function ratioOf(id: string) { if (id === 'free') return 0; if (id === 'orig') return frame.value.w / frame.value.h; const [a, b] = id.split(':').map(Number); return a / b }
function setAspect(id: string) {
  st.geo.aspect = id; buzz(); const r = ratioOf(id)
  if (!r) { commit(); return }
  const k = r * frame.value.h / frame.value.w; let w = 1, h = 1 / k; if (h > 1) { h = 1; w = k }
  st.geo.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }; commit()
}
function cropMove(e: PointerEvent) {
  const dx = (e.clientX - g.sx) / g.rw, dy = (e.clientY - g.sy) / g.rh, o = g.o, m: string = g.mode, c = st.geo.crop
  const MIN = 0.05, cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  if (m === 'move') { c.x = cl(o.x + dx, 0, 1 - o.w); c.y = cl(o.y + dy, 0, 1 - o.h); return }
  let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h
  if (m.includes('w')) x1 = cl(x1 + dx, 0, x2 - MIN); if (m.includes('e')) x2 = cl(x2 + dx, x1 + MIN, 1)
  if (m.includes('n')) y1 = cl(y1 + dy, 0, y2 - MIN); if (m.includes('s')) y2 = cl(y2 + dy, y1 + MIN, 1)
  const r = ratioOf(st.geo.aspect)
  if (r) {
    const k = r * frame.value.h / frame.value.w; let w = x2 - x1, h = w / k
    if (m === 'n' || m === 's') { h = y2 - y1; w = h * k }
    const maxH = m.includes('n') ? y2 : 1 - y1; if (h > maxH) { h = maxH; w = h * k }
    const maxW = m.includes('w') ? x2 : 1 - x1; if (w > maxW) { w = maxW; h = w / k }
    if (m.includes('w')) x1 = x2 - w; else x2 = x1 + w
    if (m.includes('n')) y1 = y2 - h; else y2 = y1 + h
  }
  st.geo.crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
function rotate90() { st.geo.rot = (st.geo.rot + 1) % 4; st.geo.crop = { x: 0, y: 0, w: 1, h: 1 }; buzz(); setAspect(st.geo.aspect) }
function flipH() { st.geo.flipH = !st.geo.flipH; buzz(); commit() }
function resetGeo() { st.geo = defaultState().geo; buzz(); commit() }
const cropStyle = computed(() => { const c = st.geo.crop; return { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' } })

// ---------- adjust ----------
const adjKey = ref<AdjKey>('exposure')
const adjTool = computed(() => adjTools.find(t => t.k === adjKey.value)!)
function autoEnhance() {
  const { data } = pixels(prev(), 256), n = data.length / 4, hist = new Uint32Array(256); let r = 0, gg = 0, b = 0, sat = 0
  for (let i = 0; i < data.length; i += 4) { const l = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]); hist[l]++; r += data[i]; gg += data[i + 1]; b += data[i + 2]; sat += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) }
  const pct = (p: number) => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= n * p) return i / 255 } return 1 }
  const lo = pct(0.02), hi2 = pct(0.98), mid = pct(0.5), cl = (v: number, m = 60) => Math.round(Math.max(-m, Math.min(m, v)))
  const a = zeroAdj()
  a.exposure = cl(Math.log2(0.46 / Math.max(0.05, mid)) * 45, 50); a.contrast = cl((0.85 - (hi2 - lo)) * 60, 35)
  a.shadows = cl(lo > 0.08 ? 0 : 20 - lo * 100, 30); a.highlights = cl(hi2 > 0.97 ? -25 : 0, 30)
  a.vibrance = cl(35 - sat / n / 255 * 100, 35); a.saturation = 6; a.warmth = cl(-((r - b) / n / 255) * 60, 20); a.tint = cl(((gg - (r + b) / 2) / n / 255) * 60, 15); a.sharpness = 15
  st.adj = a; commit(); buzz(15); toast('Автоулучшение применено')
}
const adjChanged = computed(() => adjTools.some(t => st.adj[t.k] !== 0))

// ---------- filters with thumbnails ----------
const thumbs = ref<Record<string, string>>({})
let thumbR: Renderer | null = null, thumbT: any
async function makeThumbs() {
  if (!st.src) return
  thumbR ||= new Renderer(document.createElement('canvas'))
  const p = prev(), s = 120 / Math.max(p.width, p.height), tb = await createImageBitmap(p, { resizeWidth: Math.max(1, Math.round(p.width * s)), resizeHeight: Math.max(1, Math.round(p.height * s)) })
  thumbR.setSource(tb, tb.width, tb.height)
  const o: Record<string, string> = {}, base = JSON.parse(JSON.stringify(st))
  for (const f of filters) { base.filter = { id: f.id, strength: 100 }; thumbR.render(base); o[f.id] = thumbR.canvas.toDataURL('image/jpeg', 0.75) }
  thumbs.value = o
}
watch(() => [tab.value, st.src, JSON.stringify(st.geo), JSON.stringify(st.adj)], () => { if (tab.value === 'filters') { clearTimeout(thumbT); thumbT = setTimeout(makeThumbs, 200) } })
function pickFilter(id: string) { buzz(); if (st.filter.id !== id) st.filter = { id, strength: 100 }; commit() }

// ---------- text & stickers ----------
const uid = () => Math.random().toString(36).slice(2, 9)
function addText() { const it: TextItem = { id: uid(), type: 'text', text: 'Текст', x: 0.5, y: 0.5, size: 0.09, rot: 0, color: '#ffffff', font: fonts[0].id, bg: false }; st.items.push(it); selItem.value = it.id; commit(); nextTick(() => textInput.value?.select()) }
function addSticker(e: string) { const it: Item = { id: uid(), type: 'sticker', text: e, x: 0.5 + (Math.random() - 0.5) * 0.2, y: 0.5 + (Math.random() - 0.5) * 0.2, size: 0.18, rot: 0 }; st.items.push(it); selItem.value = it.id; buzz(); commit() }
const sel = computed(() => st.items.find(i => i.id === selItem.value) || null)
const selText = computed(() => sel.value?.type === 'text' ? sel.value as TextItem : null)
function delItem() { st.items = st.items.filter(i => i.id !== selItem.value); selItem.value = null; buzz(); commit() }
const textInput = ref<HTMLTextAreaElement>()
const selSize = computed({ get: () => Math.round((sel.value?.size || 0) * 100), set: (v: number) => { if (sel.value) sel.value.size = v / 100 } })

// ---------- draw ----------
const brush = reactive({ color: '#ff3b30', size: 12, erase: false })

// ---------- AI ----------
type AiTool = 'bg' | 'obj' | 'erase' | 'up'
const aiTool = ref<AiTool>('bg')
const aiTools: { id: AiTool; l: string; i: any }[] = [{ id: 'bg', l: 'Фон', i: Scissors }, { id: 'obj', l: 'Объект', i: Pointer }, { id: 'erase', l: 'Удалить', i: Eraser }, { id: 'up', l: 'Увеличить', i: Maximize2 }]
const bgBrush = ref<'off' | 'restore' | 'erase'>('off')
const maskBrush = ref(8)
watch([aiTool, tab], () => { if (!(tab.value === 'ai' && (aiTool.value === 'obj' || aiTool.value === 'erase'))) { brushMask.value = null; samPts.value = [] } else if (aiTool.value === 'erase' && samPts.value.length) { brushMask.value = null; samPts.value = [] } scheduleRender() })
async function aiRun<T>(f: () => Promise<T>): Promise<T | undefined> {
  if (!navigator.onLine) toast('Нет сети: модель загрузится, только если уже сохранена', 3000)
  busy.value = { text: 'Подготовка…' }
  try { return await f() } catch (e: any) { console.error(e); toast('Ошибка ИИ: ' + (e?.message || e), 5000) } finally { busy.value = null }
}
const prog = (text: string, frac?: number) => { busy.value = { text, frac } }
async function removeBg() {
  const r = await aiRun(() => { const px = pixels(prev(), 1024); return call('bg', { img: px }, prog, [px.data.buffer]) })
  if (!r) return
  st.bg.ver = addMask(alphaCanvas(r)); if (st.bg.mode === 'off') st.bg.mode = 'transparent'; commit(); buzz(20); toast('Фон удалён — можно уточнить кистью')
}
function setBgMode(m: EditState['bg']['mode']) { st.bg.mode = m; buzz(); commit() }
// mask painting (source coords) — bg refine & inpaint brush
function startMask(n: { x: number; y: number }) {
  if (aiTool.value === 'bg') { const m = masks.get(st.bg.ver); if (!m) return; g = { kind: 'mask', c: cloneCanvas(m), last: null }; st.bg.ver = addMask(g.c) }
  else { if (!brushMask.value || samPts.value.length) { const p = prev(), s = Math.min(1, 1024 / Math.max(p.width, p.height)); const c = document.createElement('canvas'); c.width = Math.round(p.width * s); c.height = Math.round(p.height * s); brushMask.value = c; samPts.value = [] } g = { kind: 'mask', c: brushMask.value, last: null } }
  moveMask(n)
}
function moveMask(n: { x: number; y: number }) {
  const c: HTMLCanvasElement = g.c, x = c.getContext('2d')!, s = toSrc(n.x, n.y), p = prev()
  const rad = Math.max(2, maskBrush.value / 100 * 0.12 * out.w * (c.width / p.width) / Math.max(1, view.z) * 1.5)
  const erase = aiTool.value === 'bg' ? bgBrush.value === 'erase' : false
  x.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineWidth = rad * 2
  const P = { x: s.x * c.width, y: s.y * c.height }
  x.beginPath(); if (g.last) { x.moveTo(g.last.x, g.last.y); x.lineTo(P.x, P.y); x.stroke() } else { x.arc(P.x, P.y, rad, 0, 7); x.fill() }
  g.last = P
  if (aiTool.value === 'bg') renderer!.maskId = -1; scheduleRender()
}
function endMask() { if (aiTool.value === 'bg') commit(); g = { kind: 'none' } }
// SAM
const samPts = ref<number[][]>([])
const samAdd = ref(true)
let samMask: HTMLCanvasElement | null = null
async function samTap(n: { x: number; y: number }) {
  const s = toSrc(n.x, n.y); if (s.x < 0 || s.y < 0 || s.x > 1 || s.y > 1) return
  buzz(); const ptsN = [...samPts.value, [s.x, s.y, samAdd.value ? 1 : 0]]
  const r = await aiRun(() => { const px = pixels(prev(), 1024); return call('sam', { img: px, key: 'src' + st.src, pts: ptsN }, prog, [px.data.buffer]) })
  if (!r) return
  samPts.value = ptsN; samMask = alphaCanvas(r); brushMask.value = samMask; scheduleRender()
}
function samClear() { samPts.value = []; brushMask.value = null; samMask = null; scheduleRender() }
function selAsMask(invert = false) {
  const m = samMask!, c = cloneCanvas(m)
  if (invert) { const x = c.getContext('2d')!; x.globalCompositeOperation = 'xor'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height) }
  return addMask(c)
}
const recolorOpen = ref(false)
function samRecolor(color?: string) { if (!samMask) return; st.recolor = { mask: selAsMask(), color: color || st.recolor.color, amount: 100 }; recolorOpen.value = true; commit(); buzz(); samClear() }
function samCut() { if (!samMask) return; st.bg.ver = selAsMask(); st.bg.mode = 'transparent'; commit(); toast('Объект вырезан'); samClear() }
function samBlur(obj: boolean) { if (!samMask) return; st.bg.ver = selAsMask(obj); st.bg.mode = 'blur'; commit(); toast(obj ? 'Объект размыт' : 'Фон размыт'); samClear() }
async function samDelete() { if (!samMask) return; const c = cloneCanvas(samMask), x = c.getContext('2d')!; for (let a = 0; a < 8; a++) x.drawImage(samMask, Math.cos(a * Math.PI / 4) * 6, Math.sin(a * Math.PI / 4) * 6); brushMask.value = c; await runInpaint(); samClear() }
// inpaint (MI-GAN)
async function runInpaint() {
  const m = brushMask.value; if (!m) { toast('Закрасьте объект кистью'); return }
  const F = full(), sx = F.width / m.width, sy = F.height / m.height
  const md = m.getContext('2d')!.getImageData(0, 0, m.width, m.height).data
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (md[(y * m.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) { toast('Закрасьте объект кистью'); return }
  const bw = (x1 - x0 + 1) * sx, bh = (y1 - y0 + 1) * sy, side = Math.min(Math.max(F.width, F.height), Math.max(256, Math.max(bw, bh) * 2.2))
  const rw = Math.min(F.width, side), rh = Math.min(F.height, side)
  const rx = Math.max(0, Math.min(F.width - rw, (x0 + x1) / 2 * sx - rw / 2)), ry = Math.max(0, Math.min(F.height - rh, (y0 + y1) / 2 * sy - rh / 2))
  const s = Math.min(1, 512 / Math.max(rw, rh)), tw = Math.max(8, Math.round(rw * s / 8) * 8), th = Math.max(8, Math.round(rh * s / 8) * 8)
  const ic = document.createElement('canvas'); ic.width = tw; ic.height = th; const ix = ic.getContext('2d', { willReadFrequently: true })!; ix.imageSmoothingQuality = 'high'
  ix.drawImage(F, rx, ry, rw, rh, 0, 0, tw, th); const img = ix.getImageData(0, 0, tw, th)
  const mc = document.createElement('canvas'); mc.width = tw; mc.height = th; const mx = mc.getContext('2d', { willReadFrequently: true })!
  mx.drawImage(m, rx / sx, ry / sy, rw / sx, rh / sy, 0, 0, tw, th); const ma = mx.getImageData(0, 0, tw, th).data, mask = new Uint8ClampedArray(tw * th)
  for (let i = 0; i < mask.length; i++) mask[i] = ma[i * 4 + 3] > 20 ? 255 : 0
  const r = await aiRun(() => call('inpaint', { img: { data: img.data, w: tw, h: th }, mask }, prog, [img.data.buffer, mask.buffer]))
  if (!r) return
  const rc = document.createElement('canvas'); rc.width = tw; rc.height = th; rc.getContext('2d')!.putImageData(new ImageData(r.data, tw, th), 0, 0)
  const tmp = document.createElement('canvas'); tmp.width = Math.round(rw); tmp.height = Math.round(rh); const tx = tmp.getContext('2d')!
  tx.drawImage(rc, 0, 0, tmp.width, tmp.height); tx.globalCompositeOperation = 'destination-in'; tx.filter = `blur(${Math.max(1, 3 / s)}px)`
  tx.drawImage(m, rx / sx, ry / sy, rw / sx, rh / sy, 0, 0, tmp.width, tmp.height); tx.drawImage(m, rx / sx, ry / sy, rw / sx, rh / sy, 0, 0, tmp.width, tmp.height)
  const outC = bitmapCanvas(F); outC.getContext('2d')!.drawImage(tmp, Math.round(rx), Math.round(ry))
  st.src = await addSource(await createImageBitmap(outC)); brushMask.value = null; commit(); buzz(20); toast('Объект удалён')
}
// upscale (Swin2SR)
const upInfo = computed(() => { const f = sources.get(st.src); return f ? { w: f.width, h: f.height } : { w: 0, h: 0 } })
async function upscale(k: number) {
  const F = full(), W = F.width * k, H = F.height * k, max = Math.min(renderer?.maxTex || 4096, 8192)
  if (W > max || H > max || W * H > 24e6) { toast(`Слишком большое для ×${k}: максимум ${max}px по стороне. Сначала уменьшите/обрежьте фото.`, 4000); return }
  const r = await aiRun(() => { const px = pixels(F); return call('upscale', { img: px, scale: k }, prog, [px.data.buffer]) })
  if (!r) return
  const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; c.getContext('2d')!.putImageData(new ImageData(r.data, r.w, r.h), 0, 0)
  st.src = await addSource(await createImageBitmap(c)); commit(); buzz(20); toast(`Увеличено до ${r.w}×${r.h}`)
}

// ---------- export ----------
const exportOpen = ref(false)
const ex = reactive({ size: 0, type: 'image/jpeg', quality: 90 })
const est = shallowRef<{ blob: Blob; w: number; h: number } | null>(null)
const fullDims = computed(() => { hv.value; const f = sources.get(st.src); return f ? outDims(st.geo, f.width, f.height) : { w: 0, h: 0 } })
const sizePresets = computed(() => { const L = Math.max(fullDims.value.w, fullDims.value.h); return [{ v: 0, l: 'Оригинал' }, ...[4096, 2048, 1080].filter(v => v < L).map(v => ({ v, l: String(v) }))] })
let exR: Renderer | null = null
async function renderExport(): Promise<{ blob: Blob; w: number; h: number }> {
  const F = full(), d = outDims(st.geo, F.width, F.height), L = Math.max(d.w, d.h), sc = ex.size ? Math.min(1, ex.size / L) : 1
  exR ||= new Renderer(document.createElement('canvas'))
  const lim = exR.maxTex, ss = Math.min(1, lim / Math.max(F.width, F.height), sc < 0.75 ? sc * 1.5 : 1)
  const src = ss < 1 ? await createImageBitmap(F, { resizeWidth: Math.round(F.width * ss), resizeHeight: Math.round(F.height * ss), resizeQuality: 'high' }) : F
  exR.setSource(src, src.width, src.height); exR.setMask(masks.get(st.bg.ver) || null); exR.setSel(masks.get(st.recolor.mask) || null); exR.selId = st.recolor.mask
  const W = exact.value ? exact.value.w : Math.max(1, Math.round(d.w * sc)), H = exact.value ? exact.value.h : Math.max(1, Math.round(d.h * sc))
  exR.render(st, { w: Math.min(W, lim), h: Math.min(H, lim) })
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')!
  if (ex.type === 'image/jpeg' && !preset.value.sticker) { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H) }
  x.drawImage(exR.canvas, 0, 0, W, H); drawOverlays(x, W, H, st, null, null, true)
  if (src !== F) src.close()
  if (preset.value.sticker) {
    const stc = makeSticker(c, { ...stickerOpts }), blob = await encodeLimited(stc, ex.type === 'image/png' ? 'image/png' : 'image/webp')
    return { blob, w: stc.width, h: stc.height }
  }
  return { blob: await toBlob(c, ex.type, ex.quality / 100), w: W, h: H }
}
let estT: any, estSeq = 0
watch(() => [exportOpen.value, ex.size, ex.type, ex.quality, exact.value], () => {
  if (exportOpen.value && preset.value.sticker && ex.type === 'image/jpeg') ex.type = 'image/webp'
  if (!exportOpen.value) return; clearTimeout(estT); est.value = null; const my = ++estSeq
  estT = setTimeout(async () => { const r = await renderExport(); if (my === estSeq) est.value = r; if (r.blob.type !== ex.type) toast('Формат не поддерживается, будет ' + r.blob.type) }, 350)
})
const ext = computed(() => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' } as Record<string, string>)[est.value?.blob.type || ex.type] || 'jpg')
const outName = computed(() => `${fileName.value}-edit.${ext.value}`)
const fmtSize = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.round(n / 1024) + ' КБ'
function download() { if (!est.value) return; platform.saveFile(est.value.blob, outName.value); buzz(15); toast('Сохранено') }
const canShare = computed(() => { const b = est.value?.blob; return !!b && platform.canShareFiles([new File([b], outName.value, { type: b.type })]) })
async function share() { try { await platform.shareFiles([new File([est.value!.blob], outName.value, { type: est.value!.blob.type })]) } catch (e: any) { if (e?.name !== 'AbortError') toast('Не удалось поделиться') } }
const transparentBg = computed(() => (st.bg.ver && st.bg.mode === 'transparent') || (st.frame.kind === 'circle' && !st.frame.color))

// ---------- launch ----------
onMounted(async () => {
  new ResizeObserver(([e]) => { stageSize.w = e.contentRect.width; stageSize.h = e.contentRect.height }).observe(stage.value!)
  if (pending.value) { const f = pending.value.files[0]; pending.value = null; if (f) await loadFile(f, f.name) }
  if (!loaded.value && scen.value.id === 'edit') draft.value = (await getDraft()) || null
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo() }
    else if (k === '0') fitView()
    else if (k === '\\' && !e.repeat) comparing.value = true
  })
  window.addEventListener('keyup', (e) => { if (e.key === '\\') comparing.value = false })
  window.addEventListener('pagehide', () => { flushSave() })
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave() })
})
void toRaw; void cutout
</script>

<template>
  <div class="app" :class="{ editing: loaded }" @dragover.prevent="dragOver = true" @dragleave.self="dragOver = false" @drop.prevent="onDrop">
    <header v-if="loaded" class="top">
      <button class="ib" @click="close" aria-label="Закрыть"><X :size="22" /></button>
      <div class="mid">
        <button class="ib" @click="undo" :disabled="!canUndo" aria-label="Отменить"><Undo2 :size="20" /></button>
        <button class="ib" @click="redo" :disabled="!canRedo" aria-label="Повторить"><Redo2 :size="20" /></button>
        <button class="ib" :class="{ on: comparing }" aria-label="Сравнить (удерживайте)" title="Удерживайте, чтобы сравнить с оригиналом"
          @pointerdown="comparing = true; buzz()" @pointerup="comparing = false" @pointerleave="comparing = false" @pointercancel="comparing = false" @contextmenu.prevent><Eye :size="20" /></button>
      </div>
      <button class="pill" @click="exportOpen = true; buzz()"><Download :size="17" />Экспорт</button>
    </header>

    <main ref="stage" class="stage" :class="{ over: dragOver, checker: transparentBg }" @pointerdown="pdown" @pointermove="pmove" @pointerup="pup" @pointercancel="pup" @wheel="onWheel">
      <button v-if="!loaded" class="ib back" @click="router.push('/')" aria-label="Назад"><ChevronLeft :size="26" /></button>
      <div v-if="!loaded" class="empty">
        <div class="logo"><ImagePlus :size="40" :stroke-width="1.5" /></div>
        <h1>{{ scen.title }}</h1>
        <p class="sub">{{ scen.desc }}.<br />Всё обрабатывается на вашем устройстве.</p>
        <label class="big"><ImagePlus :size="20" />Открыть фото<input type="file" accept="image/*" hidden @change="onPick" /></label>
        <label class="ghost"><Camera :size="18" />Снять камерой<input type="file" accept="image/*" capture="environment" hidden @change="onPick" /></label>
        <div v-if="draft" class="draft">
          <img v-if="draft.thumb" :src="draft.thumb" alt="" />
          <div><b>Черновик</b><small>{{ draft.name }} · {{ new Date(draft.savedAt).toLocaleString('ru') }}</small></div>
          <button class="pill sm" @click="resume"><History :size="15" />Продолжить</button>
          <button class="ib sm" @click="discardDraft" aria-label="Удалить черновик"><Trash2 :size="16" /></button>
        </div>
        <p class="hint">или перетащите файл в это окно</p>
      </div>
      <div v-show="loaded" class="view" :class="{ anim: view.anim }"
        :style="{ clipPath: st.frame.kind === 'circle' && !st.frame.color && tab !== 'crop' ? 'circle(' + Math.min(disp.w, disp.h) / 2 + 'px)' : undefined, width: disp.w + 'px', height: disp.h + 'px', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`, '--iz': 1 / view.z }">
        <canvas ref="ulc" class="ul" />
        <canvas ref="glc" class="gl" />
        <canvas ref="ovc" class="ov" />
        <div v-if="tab === 'crop' && !comparing" class="cropLayer">
          <div class="crop" :style="cropStyle" data-h="move">
            <i v-for="h in ['nw','ne','sw','se','n','s','e','w']" :key="h" :class="'h ' + h" :data-h="h" />
          </div>
        </div>
      </div>
      <Transition name="fade"><div v-if="zoomLabel" class="zoomlbl">{{ zoomLabel }}</div></Transition>
      <Transition name="fade"><div v-if="comparing" class="zoomlbl">Оригинал</div></Transition>
      <Transition name="fade">
        <div v-if="busy" class="busy"><div class="spinner" /><span>{{ busy.text }}</span>
          <div v-if="busy.frac != null" class="bar"><i :style="{ width: busy.frac * 100 + '%' }" /></div></div>
      </Transition>
    </main>

    <template v-if="loaded">
      <section class="tools">
        <Transition name="slide" mode="out-in">
          <div :key="tab" class="pane">
            <!-- STICKER -->
            <template v-if="tab === 'sticker'">
              <Ruler v-model="stickerOpts.outline" :min="0" :max="20" :def="6" label="Обводка" />
              <div class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: stickerOpts.color === c }" :style="{ background: c }" @click="stickerOpts.color = c" /></div>
              <div class="row"><Ruler v-model="stickerOpts.shadow" :min="0" :max="100" :def="40" label="Тень" />
                <input class="tin cap" v-model="stickerOpts.caption" placeholder="Подпись" maxlength="24" /></div>
              <small class="note">Экспорт: 512 px, WebP/PNG ≤ 512 КБ — готово для @Stickers. <button class="link" @click="removeBg">Вырезать заново</button></small>
            </template>
            <!-- CROP -->
            <template v-else-if="tab === 'crop'">
              <div v-if="preset.social" class="chips">
                <button v-for="sp in socialPresets" :key="sp.id" class="chip" :class="{ on: exact && exact.w === sp.w && exact.h === sp.h }" @click="setSocial(sp)">{{ sp.l }}</button>
              </div>
              <div class="chips">
                <button v-for="a in aspects" :key="a.id" class="chip" :class="{ on: st.geo.aspect === a.id }" @click="setAspect(a.id)">{{ a.l }}</button>
              </div>
              <div class="row">
                <button class="ib" @click="rotate90" aria-label="Повернуть на 90°"><RotateCw :size="20" /></button>
                <Ruler v-model="st.geo.angle" :min="-45" :max="45" :step="0.5" unit="°" label="Наклон" @commit="commit" />
                <button class="ib" :class="{ on: st.geo.flipH }" @click="flipH" aria-label="Отразить"><FlipHorizontal2 :size="20" /></button>
              </div>
              <button class="link" @click="resetGeo">Сбросить кадр</button>
            </template>
            <!-- ADJUST -->
            <template v-else-if="tab === 'adjust'">
              <Ruler v-model="st.adj[adjKey]" :min="adjTool.min" :max="adjTool.max" :label="adjTool.l" @commit="commit" />
              <div class="chips">
                <button class="chip ic" @click="autoEnhance"><Sparkles :size="18" /><span>Авто</span></button>
                <button v-for="t in adjTools" :key="t.k" class="chip ic" :class="{ on: adjKey === t.k, dot: st.adj[t.k] !== 0 }" @click="adjKey = t.k; buzz(4)"><span>{{ t.l }}</span></button>
                <button v-if="adjChanged" class="chip" @click="st.adj = zeroAdj(); commit()">Сброс</button>
              </div>
            </template>
            <!-- FILTERS -->
            <template v-else-if="tab === 'filters'">
              <Ruler v-if="st.filter.id !== 'none'" v-model="st.filter.strength" :min="0" :max="100" :def="100" label="Сила" @commit="commit" />
              <div class="chips thumbs">
                <button v-for="f in filters" :key="f.id" class="thumb" :class="{ on: st.filter.id === f.id }" @click="pickFilter(f.id)">
                  <img v-if="thumbs[f.id]" :src="thumbs[f.id]" alt="" /><i v-else /><span>{{ f.l }}</span></button>
              </div>
            </template>
            <!-- AI -->
            <template v-else-if="tab === 'ai'">
              <template v-if="aiTool === 'bg'">
                <template v-if="!st.bg.ver">
                  <button class="pill wide" @click="removeBg"><Scissors :size="18" />Удалить фон</button>
                  <small class="note">Модель RMBG-1.4 {{ MODEL_SIZES.bg }}, загружается один раз и работает офлайн</small>
                </template>
                <template v-else>
                  <div class="chips">
                    <button v-for="m in ([['transparent','Прозрачный'],['color','Цвет'],['blur','Размытие'],['off','Оригинал']] as const)" :key="m[0]" class="chip" :class="{ on: st.bg.mode === m[0] }" @click="setBgMode(m[0])">{{ m[1] }}</button>
                    <button class="chip" @click="st.bg.ver = 0; st.bg.mode = 'off'; commit()"><Trash2 :size="15" /></button>
                  </div>
                  <div v-if="st.bg.mode === 'color'" class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: st.bg.color === c }" :style="{ background: c }" @click="st.bg.color = c; commit()" /><label class="swatch pick"><input type="color" v-model="st.bg.color" @change="commit" /></label></div>
                  <Ruler v-if="st.bg.mode === 'blur'" v-model="st.bg.blur" :min="0" :max="100" :def="50" label="Размытие фона" @commit="commit" />
                  <div class="chips">
                    <button v-for="m in ([['off','Просмотр'],['restore','Кисть: вернуть'],['erase','Кисть: стереть']] as const)" :key="m[0]" class="chip" :class="{ on: bgBrush === m[0] }" @click="bgBrush = m[0]; buzz()">{{ m[1] }}</button>
                  </div>
                  <Ruler v-if="bgBrush !== 'off'" v-model="maskBrush" :min="1" :max="100" :def="8" label="Кисть" />
                </template>
              </template>
              <template v-else-if="aiTool === 'obj'">
                <template v-if="!brushMask">
                  <p class="note big">Коснитесь объекта на фото, чтобы выделить его</p>
                  <small class="note">SlimSAM {{ MODEL_SIZES.sam }}</small>
                  <template v-if="st.recolor.mask">
                    <div class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: st.recolor.color === c }" :style="{ background: c }" @click="st.recolor.color = c; commit()" /><label class="swatch pick"><input type="color" v-model="st.recolor.color" @change="commit" /></label></div>
                    <Ruler v-model="st.recolor.amount" :min="0" :max="100" :def="100" label="Перекраска" @commit="commit" />
                  </template>
                </template>
                <template v-else>
                  <div class="chips">
                    <button class="chip" :class="{ on: samAdd }" @click="samAdd = true">+ Добавить</button>
                    <button class="chip" :class="{ on: !samAdd }" @click="samAdd = false">− Исключить</button>
                    <button class="chip" @click="samClear">Сбросить</button>
                  </div>
                  <div class="chips">
                    <button class="chip" @click="samRecolor()">Перекрасить</button>
                    <button class="chip" @click="samCut">Вырезать</button>
                    <button class="chip" @click="samBlur(false)">Размыть фон</button>
                    <button class="chip" @click="samBlur(true)">Размыть объект</button>
                    <button class="chip" @click="samDelete">Удалить</button>
                  </div>
                </template>
              </template>
              <template v-else-if="aiTool === 'erase'">
                <Ruler v-model="maskBrush" :min="1" :max="100" :def="8" label="Кисть" />
                <div class="row">
                  <button class="chip" :disabled="!brushMask" @click="brushMask = null; scheduleRender()">Очистить</button>
                  <button class="pill" :disabled="!brushMask" @click="runInpaint"><Eraser :size="17" />Удалить объект</button>
                </div>
                <small class="note">Закрасьте лишнее и нажмите «Удалить». MI-GAN {{ MODEL_SIZES.inpaint }}</small>
              </template>
              <template v-else>
                <div class="row">
                  <button class="pill" @click="upscale(2)">×2</button>
                  <button class="pill" @click="upscale(4)">×4</button>
                </div>
                <small class="note">Сейчас {{ upInfo.w }}×{{ upInfo.h }}. Swin2SR, ×2 {{ MODEL_SIZES.up2 }}, ×4 {{ MODEL_SIZES.up4 }}. На телефоне без WebGPU может занять несколько минут.</small>
              </template>
              <div class="chips">
                <button v-for="t in aiTools" :key="t.id" class="chip ic" :class="{ on: aiTool === t.id }" @click="aiTool = t.id; buzz(4)"><component :is="t.i" :size="17" /><span>{{ t.l }}</span></button>
              </div>
            </template>
            <!-- TEXT -->
            <template v-else-if="tab === 'text'">
              <template v-if="selText">
                <textarea ref="textInput" v-model="selText.text" rows="1" class="tin" @change="commit" placeholder="Текст" />
                <div class="chips">
                  <button v-for="f in fonts" :key="f.id" class="chip" :class="{ on: selText.font === f.id }" :style="{ fontFamily: f.id }" @click="selText.font = f.id; commit()">{{ f.l }}</button>
                  <button class="chip" :class="{ on: selText.bg }" @click="selText.bg = !selText.bg; commit()">Фон</button>
                </div>
                <div class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: selText.color === c }" :style="{ background: c }" @click="selText.color = c; commit()" /><label class="swatch pick"><input type="color" v-model="selText.color" @change="commit" /></label></div>
                <div class="row"><Ruler v-model="selSize" :min="2" :max="60" :def="9" label="Размер" @commit="commit" /><button class="ib" @click="delItem" aria-label="Удалить"><Trash2 :size="20" /></button></div>
              </template>
              <template v-else>
                <button class="pill wide" @click="addText"><Plus :size="18" />Добавить текст</button>
                <small class="note">Перетаскивайте текст пальцем, щипок — размер и поворот</small>
              </template>
            </template>
            <!-- DRAW -->
            <template v-else-if="tab === 'draw'">
              <div class="chips">
                <button class="chip ic" :class="{ on: !brush.erase }" @click="brush.erase = false"><Brush :size="17" /><span>Кисть</span></button>
                <button class="chip ic" :class="{ on: brush.erase }" @click="brush.erase = true"><Eraser :size="17" /><span>Ластик</span></button>
                <button class="chip" :disabled="!st.strokes.length" @click="st.strokes = []; commit()">Очистить</button>
              </div>
              <div class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: brush.color === c && !brush.erase }" :style="{ background: c }" @click="brush.color = c; brush.erase = false" /><label class="swatch pick"><input type="color" v-model="brush.color" /></label></div>
              <Ruler v-model="brush.size" :min="1" :max="100" :def="12" label="Толщина" />
            </template>
            <!-- STICKERS -->
            <template v-else-if="tab === 'stickers'">
              <div v-if="sel && sel.type === 'sticker'" class="row"><Ruler v-model="selSize" :min="3" :max="100" :def="18" label="Размер" @commit="commit" /><button class="ib" @click="delItem" aria-label="Удалить"><Trash2 :size="20" /></button></div>
              <div class="emojis"><button v-for="e in emojis" :key="e" @click="addSticker(e)">{{ e }}</button></div>
            </template>
            <!-- FRAME -->
            <template v-else-if="tab === 'frame'">
              <div class="chips"><button v-for="f in frames" :key="f.id" class="chip" :class="{ on: st.frame.kind === f.id }" @click="st.frame.kind = f.id; buzz(); commit()">{{ f.l }}</button></div>
              <template v-if="st.frame.kind !== 'none'">
                <Ruler v-model="st.frame.size" :min="0" :max="100" :def="30" label="Толщина" @commit="commit" />
                <div v-if="st.frame.kind !== 'film'" class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: st.frame.color === c }" :style="{ background: c }" @click="st.frame.color = c; commit()" /><label class="swatch pick"><input type="color" v-model="st.frame.color" @change="commit" /></label></div>
              </template>
            </template>
          </div>
        </Transition>
      </section>
      <nav class="tabbar">
        <button v-for="t in (preset.sticker ? [stickerTab, ...tabs] : tabs)" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id; buzz(4)"><component :is="t.i" :size="22" :stroke-width="1.75" /><span>{{ t.l }}</span></button>
      </nav>
    </template>

    <Transition name="sheet">
      <div v-if="exportOpen" class="scrim" @click.self="exportOpen = false">
        <div class="sheet">
          <div class="grab" />
          <h3>Экспорт</h3>
          <template v-if="!preset.sticker">
          <label class="lbl">Размер{{ exact ? '' : ' (длинная сторона)' }}</label>
          <div v-if="exact" class="chips"><button class="chip on">{{ exact.w }}×{{ exact.h }}</button><button class="chip" @click="exact = null">Свой размер</button></div>
          <div v-else class="chips"><button v-for="p in sizePresets" :key="p.v" class="chip" :class="{ on: ex.size === p.v }" @click="ex.size = p.v">{{ p.l }}</button></div>
          </template>
          <label class="lbl">Формат</label>
          <div class="chips"><button v-for="t in (preset.sticker ? [['image/webp','WebP'],['image/png','PNG']] : [['image/jpeg','JPEG'],['image/webp','WebP'],['image/png','PNG']])" :key="t[0]" class="chip" :class="{ on: ex.type === t[0] }" @click="ex.type = t[0]">{{ t[1] }}</button></div>
          <small v-if="transparentBg && ex.type === 'image/jpeg'" class="note">JPEG не поддерживает прозрачность — фон станет белым. Выберите PNG или WebP.</small>
          <Ruler v-if="ex.type !== 'image/png' && !preset.sticker" v-model="ex.quality" :min="10" :max="100" :def="90" label="Качество" />
          <p class="est">{{ est ? `${est.w}×${est.h} · ${fmtSize(est.blob.size)}` : 'Расчёт размера…' }}</p>
          <div class="row">
            <button class="pill wide" :disabled="!est" @click="download"><Download :size="18" />Сохранить</button>
            <button v-if="canShare" class="pill wide alt" @click="share"><Share2 :size="18" />Поделиться</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="fade"><div v-if="msg" class="toast">{{ msg }}</div></Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ImagePlus, Download, Shuffle } from 'lucide-vue-next'
import Ruler from '../components/Ruler.vue'
import { canvas, toBlob } from '../tools/image'
import { colors } from '../state'
import { platform } from '../platform'
import { pending } from '../store'
type Cell = [number, number, number, number]
const router = useRouter()
const imgs = ref<ImageBitmap[]>([])
const offs = reactive<{ x: number; y: number; z: number }[]>([])
const o = reactive({ tpl: 0, aspect: '1:1', gap: 12, radius: 8, bg: '#ffffff' })
const cv = ref<HTMLCanvasElement>(), msg = ref('')
function grid(n: number, cols: number): Cell[] {
  const rows = Math.ceil(n / cols), out: Cell[] = []
  for (let r = 0; r < rows; r++) { const c = r === rows - 1 ? n - cols * (rows - 1) : cols; for (let i = 0; i < c; i++) out.push([i / c, r / rows, 1 / c, 1 / rows]) }
  return out
}
function templates(n: number): Cell[][] {
  const t: Cell[][] = []
  if (n === 1) return [[[0, 0, 1, 1]]]
  if (n === 2) t.push([[0, 0, .5, 1], [.5, 0, .5, 1]], [[0, 0, 1, .5], [0, .5, 1, .5]], [[0, 0, .62, 1], [.62, 0, .38, 1]])
  if (n === 3) t.push([[0, 0, .5, 1], [.5, 0, .5, .5], [.5, .5, .5, .5]], [[0, 0, 1, .5], [0, .5, .5, .5], [.5, .5, .5, .5]], [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]])
  if (n === 4) t.push(grid(4, 2), [[0, 0, 1, .62], [0, .62, 1 / 3, .38], [1 / 3, .62, 1 / 3, .38], [2 / 3, .62, 1 / 3, .38]], [[0, 0, .62, 1], [.62, 0, .38, 1 / 3], [.62, 1 / 3, .38, 1 / 3], [.62, 2 / 3, .38, 1 / 3]])
  if (n >= 5) t.push(grid(n, Math.ceil(Math.sqrt(n))), grid(n, Math.max(2, Math.floor(Math.sqrt(n)))))
  if (n >= 5 && n <= 6) t.push([[0, 0, 2 / 3, 2 / 3], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], ...grid(n - 3, n - 3).map(c => [c[0], 2 / 3, c[2], 1 / 3] as Cell)])
  return t
}
const tpls = computed(() => templates(Math.max(1, imgs.value.length)))
const cells = computed(() => tpls.value[Math.min(o.tpl, tpls.value.length - 1)] || [])
const ratio = computed(() => { const [a, b] = o.aspect.split(':').map(Number); return a / b })
async function add(list: FileList | File[]) {
  for (const f of Array.from(list).slice(0, 9 - imgs.value.length)) { try { imgs.value.push(await createImageBitmap(f, { imageOrientation: 'from-image' } as any)); offs.push({ x: 0, y: 0, z: 1 }) } catch { /* skip */ } }
  o.tpl = 0; draw()
}
function rr(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) { r = Math.min(r, w / 2, h / 2); x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath() }
function render(c: HTMLCanvasElement, L: number) {
  const W = ratio.value >= 1 ? L : L * ratio.value, H = ratio.value >= 1 ? L / ratio.value : L
  c.width = Math.round(W); c.height = Math.round(H); const x = c.getContext('2d')!, k = L / 1000, g = o.gap * k
  x.fillStyle = o.bg; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = 'high'
  cells.value.forEach((cl, i) => {
    const im = imgs.value[i]; if (!im) return
    const X = g + cl[0] * (W - g) , Y = g + cl[1] * (H - g), w = cl[2] * (W - g) - g, h = cl[3] * (H - g) - g
    const of = offs[i], s = Math.max(w / im.width, h / im.height) * of.z, dw = im.width * s, dh = im.height * s
    const mx = (dw - w) / 2, my = (dh - h) / 2
    x.save(); rr(x, X, Y, w, h, o.radius * k); x.clip()
    x.drawImage(im, X - mx + Math.max(-mx, Math.min(mx, of.x * w)), Y - my + Math.max(-my, Math.min(my, of.y * h)), dw, dh); x.restore()
  })
}
function draw() { nextTick(() => cv.value && render(cv.value, 1200)) }
watch(o, draw, { deep: true }); watch(offs, draw, { deep: true })
// drag inside a cell to reposition, wheel to zoom
let drag: { i: number; sx: number; sy: number; ox: number; oy: number; w: number; h: number } | null = null
function cellAt(e: PointerEvent) {
  const r = cv.value!.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height
  return cells.value.findIndex(c => px >= c[0] && px <= c[0] + c[2] && py >= c[1] && py <= c[1] + c[3])
}
function down(e: PointerEvent) { const i = cellAt(e); if (i < 0 || !imgs.value[i]) return; (e.target as Element).setPointerCapture(e.pointerId); const r = cv.value!.getBoundingClientRect(), c = cells.value[i]; drag = { i, sx: e.clientX, sy: e.clientY, ox: offs[i].x, oy: offs[i].y, w: c[2] * r.width, h: c[3] * r.height } }
function move(e: PointerEvent) { if (!drag) return; offs[drag.i].x = drag.ox + (e.clientX - drag.sx) / drag.w; offs[drag.i].y = drag.oy + (e.clientY - drag.sy) / drag.h }
function wheel(e: WheelEvent) { const i = cellAt(e as any); if (i < 0) return; e.preventDefault(); offs[i].z = Math.max(1, Math.min(4, offs[i].z * Math.exp(-e.deltaY * 0.002))) }
function shuffle() { const a = imgs.value; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] } offs.forEach(f => Object.assign(f, { x: 0, y: 0, z: 1 })); draw(); platform.haptic() }
async function save() { const c = canvas(1, 1); render(c, 2400); await platform.saveFile(await toBlob(c, 'image/jpeg', 0.92), 'collage.jpg'); platform.haptic('success'); msg.value = 'Сохранено'; setTimeout(() => msg.value = '', 2000) }
onMounted(() => { if (pending.value) { add(pending.value.files); pending.value = null } })
</script>
<template>
  <div class="page">
    <header class="top"><button class="ib" @click="router.push('/')" aria-label="Назад"><ChevronLeft :size="26" /></button><b>Коллаж</b>
      <button class="pill" :disabled="!imgs.length" @click="save"><Download :size="17" />Сохранить</button></header>
    <main class="stage2">
      <label v-if="!imgs.length" class="drop"><ImagePlus :size="28" /><b>Выберите 2–9 фото</b><input type="file" accept="image/*" multiple hidden @change="add(($event.target as HTMLInputElement).files!)" /></label>
      <canvas v-show="imgs.length" ref="cv" class="cv" @pointerdown="down" @pointermove="move" @pointerup="drag = null" @pointercancel="drag = null" @wheel="wheel" />
    </main>
    <section v-if="imgs.length" class="tools2">
      <div class="chips">
        <button v-for="(t, i) in tpls" :key="i" class="tpl" :class="{ on: o.tpl === i }" @click="o.tpl = i; platform.haptic()">
          <svg viewBox="0 0 40 40"><rect v-for="(c, j) in t" :key="j" :x="c[0] * 40 + 1.5" :y="c[1] * 40 + 1.5" :width="c[2] * 40 - 3" :height="c[3] * 40 - 3" rx="2.5" /></svg></button>
        <label class="chip"><ImagePlus :size="16" />Ещё<input type="file" accept="image/*" multiple hidden @change="add(($event.target as HTMLInputElement).files!)" /></label>
        <button class="chip" @click="shuffle"><Shuffle :size="16" /></button>
      </div>
      <div class="chips"><button v-for="a in ['1:1', '4:5', '9:16', '16:9', '3:2']" :key="a" class="chip" :class="{ on: o.aspect === a }" @click="o.aspect = a">{{ a }}</button></div>
      <div class="row"><Ruler v-model="o.gap" :min="0" :max="60" :def="12" label="Отступ" /><Ruler v-model="o.radius" :min="0" :max="80" :def="8" label="Скругление" /></div>
      <div class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: o.bg === c }" :style="{ background: c }" @click="o.bg = c" /></div>
    </section>
    <Transition name="fade"><div v-if="msg" class="toast">{{ msg }}</div></Transition>
  </div>
</template>
<style scoped>
.page{display:flex;flex-direction:column;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.stage2{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:12px}
.cv{max-width:100%;max-height:100%;touch-action:none;border-radius:4px;box-shadow:0 4px 30px #0004}
.drop{display:flex;flex-direction:column;align-items:center;gap:8px;padding:40px;border:1.5px dashed var(--fg3);border-radius:22px;cursor:pointer}
.tools2{flex:none;display:flex;flex-direction:column;gap:6px;padding:6px 10px calc(10px + env(safe-area-inset-bottom));max-width:640px;width:100%;margin:0 auto}
.tpl{flex:none;width:48px;height:48px;border-radius:12px;background:var(--chip);padding:5px}.tpl svg{width:100%;height:100%;fill:var(--fg3)}.tpl.on svg{fill:var(--accent)}
</style>

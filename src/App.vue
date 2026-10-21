<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { run, exportBlob, usingWorker } from './engine'
import type { Adjust, Job } from './ops'

const { needRefresh, updateServiceWorker } = useRegisterSW()
const canvas = ref<HTMLCanvasElement>()
const stage = ref<HTMLDivElement>()
const history = ref<ImageBitmap[]>([]); const idx = ref(-1)
const cur = computed(() => history.value[idx.value] as ImageBitmap | undefined)
const tab = ref<'crop' | 'adjust' | 'export' | null>(null)
const busy = ref(false); const msg = ref(''); const dragOver = ref(false)
const fileName = ref('photo')

function push(b: ImageBitmap) {
  history.value = history.value.slice(0, idx.value + 1); history.value.push(b)
  if (history.value.length > 25) history.value.shift()
  idx.value = history.value.length - 1
}
const undo = () => { if (idx.value > 0) idx.value-- }
const redo = () => { if (idx.value < history.value.length - 1) idx.value++ }

async function loadFile(f: Blob, name = 'photo') {
  try {
    busy.value = true
    const b = await createImageBitmap(f, { imageOrientation: 'from-image' } as any)
    history.value = []; idx.value = -1; push(b)
    fileName.value = name.replace(/\.[^.]+$/, '') || 'photo'; tab.value = null
  } catch { toast('Не удалось открыть изображение') } finally { busy.value = false }
}
function onPick(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadFile(f, f.name); (e.target as HTMLInputElement).value = '' }
function onDrop(e: DragEvent) { dragOver.value = false; const f = e.dataTransfer?.files[0]; if (f && f.type.startsWith('image/')) loadFile(f, f.name) }
function toast(t: string) { msg.value = t; setTimeout(() => msg.value === t && (msg.value = ''), 2500) }

watch(cur, async (b) => {
  await nextTick(); const c = canvas.value; if (!c || !b) return
  c.width = b.width; c.height = b.height; c.getContext('2d')!.drawImage(b, 0, 0)
  resetCrop(); ex.w = b.width; ex.h = b.height; blobInfo.value = null
})

async function apply(job: Job) {
  if (!cur.value || busy.value) return
  busy.value = true
  try { push(await run(cur.value, job)) } catch (e) { toast('Ошибка: ' + e) } finally { busy.value = false }
}

// ---------- Adjust ----------
const adj = reactive<Adjust>({ brightness: 100, contrast: 100, saturation: 100, blur: 0, preset: 'none' })
const resetAdj = () => Object.assign(adj, { brightness: 100, contrast: 100, saturation: 100, blur: 0, preset: 'none' })
const previewFilter = computed(() => tab.value !== 'adjust' ? 'none' :
  `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturation}%)` +
  (adj.preset === 'grayscale' ? ' grayscale(1)' : adj.preset === 'sepia' ? ' sepia(1)' : '') +
  (adj.blur ? ` blur(${adj.blur * (canvas.value ? canvas.value.clientWidth / canvas.value.width : 1)}px)` : ''))
async function applyAdj() { await apply({ kind: 'adjust', a: { ...adj } }); resetAdj() }

// ---------- Crop ----------
const aspects = [{ l: 'Свободно', v: 0 }, { l: '1:1', v: 1 }, { l: '4:5', v: 4 / 5 }, { l: '16:9', v: 16 / 9 }]
const aspect = ref(0)
const crop = reactive({ x: 0, y: 0, w: 1, h: 1 }) // normalized
function resetCrop() { Object.assign(crop, { x: 0, y: 0, w: 1, h: 1 }); if (aspect.value) setAspect(aspect.value) }
function setAspect(v: number) {
  aspect.value = v; if (!v || !cur.value) return
  const ir = cur.value.width / cur.value.height
  let w = 1, h = ir / v; if (h > 1) { h = 1; w = v / ir }
  Object.assign(crop, { x: (1 - w) / 2, y: (1 - h) / 2, w, h })
}
let drag: { mode: string; sx: number; sy: number; o: typeof crop; rw: number; rh: number } | null = null
function down(e: PointerEvent, mode: string) {
  const r = canvas.value!.getBoundingClientRect()
  drag = { mode, sx: e.clientX, sy: e.clientY, o: { ...crop }, rw: r.width, rh: r.height };
  (e.target as Element).setPointerCapture(e.pointerId); e.preventDefault()
}
function move(e: PointerEvent) {
  if (!drag) return
  const dx = (e.clientX - drag.sx) / drag.rw, dy = (e.clientY - drag.sy) / drag.rh, o = drag.o, m = drag.mode
  const MIN = 0.05, clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  if (m === 'move') { crop.x = clamp(o.x + dx, 0, 1 - o.w); crop.y = clamp(o.y + dy, 0, 1 - o.h); return }
  let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h
  if (m.includes('w')) x1 = clamp(x1 + dx, 0, x2 - MIN); if (m.includes('e')) x2 = clamp(x2 + dx, x1 + MIN, 1)
  if (m.includes('n')) y1 = clamp(y1 + dy, 0, y2 - MIN); if (m.includes('s')) y2 = clamp(y2 + dy, y1 + MIN, 1)
  if (aspect.value && cur.value) {
    const k = aspect.value * cur.value.height / cur.value.width // w/h in normalized units
    let w = x2 - x1, h = w / k
    const maxH = m.includes('n') ? y2 : 1 - y1; if (h > maxH) { h = maxH; w = h * k }
    if (m.includes('w')) x1 = x2 - w; else x2 = x1 + w
    if (m.includes('n')) y1 = y2 - h; else y2 = y1 + h
  }
  Object.assign(crop, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
}
const up = () => { drag = null }
const cropStyle = computed(() => ({ left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' }))
async function applyCrop() {
  const b = cur.value!; aspect.value = aspect.value
  await apply({ kind: 'crop', x: Math.round(crop.x * b.width), y: Math.round(crop.y * b.height), w: Math.round(crop.w * b.width), h: Math.round(crop.h * b.height) })
}

// ---------- Export ----------
const ex = reactive({ w: 0, h: 0, lock: true, type: 'image/jpeg', quality: 0.9 })
const blobInfo = ref<{ blob: Blob; url: string } | null>(null)
function setW(v: number) { ex.w = Math.max(1, Math.round(v)); if (ex.lock && cur.value) ex.h = Math.max(1, Math.round(ex.w * cur.value.height / cur.value.width)) }
function setH(v: number) { ex.h = Math.max(1, Math.round(v)); if (ex.lock && cur.value) ex.w = Math.max(1, Math.round(ex.h * cur.value.width / cur.value.height)) }
const ext = computed(() => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' } as any)[ex.type])
let timer: any
watch(() => [ex.w, ex.h, ex.type, ex.quality, tab.value], () => { clearTimeout(timer); if (tab.value === 'export') timer = setTimeout(render, 300) })
async function render() {
  if (!cur.value) return
  const blob = await exportBlob(cur.value, { kind: 'export', w: ex.w, h: ex.h, type: ex.type, quality: ex.quality })
  if (blobInfo.value) URL.revokeObjectURL(blobInfo.value.url)
  blobInfo.value = { blob, url: URL.createObjectURL(blob) }
  if (blob.type !== ex.type) toast('Формат не поддерживается браузером, сохранено как ' + blob.type)
}
const fmtSize = (n: number) => n > 1048576 ? (n / 1048576).toFixed(2) + ' МБ' : (n / 1024).toFixed(1) + ' КБ'
const outName = computed(() => `${fileName.value}-local-editor.${ext.value}`)
function download() {
  if (!blobInfo.value) return
  const a = document.createElement('a'); a.href = blobInfo.value.url; a.download = outName.value; a.click()
}
const file = computed(() => blobInfo.value ? new File([blobInfo.value.blob], outName.value, { type: blobInfo.value.blob.type }) : null)
const canShare = computed(() => !!file.value && !!navigator.canShare?.({ files: [file.value] }))
async function share() { try { await navigator.share({ files: [file.value!], title: 'Local Editor' }) } catch (e: any) { if (e?.name !== 'AbortError') toast('Не удалось поделиться') } }

// ---------- Launch: share target / file handler ----------
onMounted(async () => {
  if (location.search.includes('shared=1') && 'caches' in window) {
    const c = await caches.open('local-editor-share'); const r = await c.match(new URL('shared-image', location.origin + import.meta.env.BASE_URL).href)
    if (r) { await loadFile(await r.blob(), decodeURIComponent(r.headers.get('X-Name') || 'shared')); await c.delete(new URL('shared-image', location.origin + import.meta.env.BASE_URL).href) }
    window.history.replaceState(null, '', '/')
  }
  const lq = (window as any).launchQueue
  lq?.setConsumer(async (p: any) => { const h = p.files?.[0]; if (h) { const f = await h.getFile(); loadFile(f, f.name) } })
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
  })
})
</script>

<template>
  <div class="app" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
    <header>
      <b>Local Editor</b>
      <div class="hbtns" v-if="cur">
        <button @click="undo" :disabled="idx <= 0" title="Отменить">↶</button>
        <button @click="redo" :disabled="idx >= history.length - 1" title="Повторить">↷</button>
        <label class="btn" title="Открыть другое">📂<input type="file" accept="image/*" hidden @change="onPick" /></label>
      </div>
    </header>

    <main ref="stage" class="stage" :class="{ over: dragOver }">
      <div v-if="!cur" class="empty">
        <p>Все операции выполняются на вашем устройстве.<br />Ничего не загружается на сервер.</p>
        <label class="big">Открыть фото<input type="file" accept="image/*" hidden @change="onPick" /></label>
        <label class="big alt">Снять камерой<input type="file" accept="image/*" capture="environment" hidden @change="onPick" /></label>
        <p class="hint">или перетащите файл сюда</p>
      </div>
      <div v-else class="wrap">
        <canvas ref="canvas" :style="{ filter: previewFilter }" />
        <div v-if="tab === 'crop'" class="cropLayer" @pointermove="move" @pointerup="up" @pointercancel="up">
          <div class="crop" :style="cropStyle" @pointerdown="down($event, 'move')">
            <i v-for="h in ['nw','ne','sw','se','n','s','e','w']" :key="h" :class="'h ' + h" @pointerdown.stop="down($event, h)" />
          </div>
        </div>
      </div>
      <div v-if="busy" class="busy">Обработка…</div>
    </main>

    <section v-if="cur && tab" class="panel">
      <template v-if="tab === 'crop'">
        <div class="row chips">
          <button v-for="a in aspects" :key="a.l" :class="{ on: aspect === a.v }" @click="setAspect(a.v)">{{ a.l }}</button>
        </div>
        <div class="row">
          <button @click="apply({ kind: 'rotate', dir: -1 })">⟲ 90°</button>
          <button @click="apply({ kind: 'rotate', dir: 1 })">⟳ 90°</button>
          <button @click="apply({ kind: 'flip', axis: 'h' })">⇋ Отразить</button>
          <button @click="apply({ kind: 'flip', axis: 'v' })">⇵ Отразить</button>
        </div>
        <div class="row"><button @click="resetCrop">Сброс</button><button class="pri" @click="applyCrop">Обрезать</button></div>
      </template>
      <template v-if="tab === 'adjust'">
        <label class="sl">Яркость <span>{{ adj.brightness }}%</span><input type="range" min="0" max="200" v-model.number="adj.brightness" /></label>
        <label class="sl">Контраст <span>{{ adj.contrast }}%</span><input type="range" min="0" max="200" v-model.number="adj.contrast" /></label>
        <label class="sl">Насыщенность <span>{{ adj.saturation }}%</span><input type="range" min="0" max="200" v-model.number="adj.saturation" /></label>
        <label class="sl">Размытие <span>{{ adj.blur }} px</span><input type="range" min="0" max="20" v-model.number="adj.blur" /></label>
        <div class="row chips">
          <button :class="{ on: adj.preset === 'none' }" @click="adj.preset = 'none'">Оригинал</button>
          <button :class="{ on: adj.preset === 'grayscale' }" @click="adj.preset = 'grayscale'">Ч/Б</button>
          <button :class="{ on: adj.preset === 'sepia' }" @click="adj.preset = 'sepia'">Сепия</button>
        </div>
        <div class="row"><button @click="resetAdj">Сброс</button><button class="pri" @click="applyAdj">Применить</button></div>
      </template>
      <template v-if="tab === 'export'">
        <div class="row">
          <label class="num">Ш <input type="number" :value="ex.w" @change="setW(+($event.target as HTMLInputElement).value)" /></label>
          <label class="num">В <input type="number" :value="ex.h" @change="setH(+($event.target as HTMLInputElement).value)" /></label>
          <label class="chk"><input type="checkbox" v-model="ex.lock" /> 🔗</label>
        </div>
        <div class="row chips">
          <button v-for="t in [['image/jpeg','JPEG'],['image/webp','WebP'],['image/png','PNG']]" :key="t[0]" :class="{ on: ex.type === t[0] }" @click="ex.type = t[0]">{{ t[1] }}</button>
        </div>
        <label v-if="ex.type !== 'image/png'" class="sl">Качество <span>{{ Math.round(ex.quality * 100) }}</span><input type="range" min="0.1" max="1" step="0.01" v-model.number="ex.quality" /></label>
        <p class="info">{{ blobInfo ? `Размер файла: ${fmtSize(blobInfo.blob.size)} · ${ex.w}×${ex.h}` : 'Расчёт…' }}</p>
        <div class="row"><button class="pri" @click="download" :disabled="!blobInfo">⬇ Скачать</button>
          <button v-if="canShare" @click="share">↗ Поделиться</button></div>
      </template>
    </section>

    <nav v-if="cur" class="toolbar">
      <button :class="{ on: tab === 'crop' }" @click="tab = tab === 'crop' ? null : 'crop'"><span>✂</span>Кадр</button>
      <button :class="{ on: tab === 'adjust' }" @click="tab = tab === 'adjust' ? null : 'adjust'"><span>☀</span>Коррекция</button>
      <button :class="{ on: tab === 'export' }" @click="tab = tab === 'export' ? null : 'export'"><span>⬇</span>Экспорт</button>
    </nav>

    <div v-if="needRefresh" class="update">Доступна новая версия
      <button class="pri" @click="updateServiceWorker(true)">Обновить</button>
      <button @click="needRefresh = false">✕</button></div>
    <div v-if="msg" class="toast">{{ msg }}</div>
    <small class="mode" v-if="cur">{{ usingWorker() ? 'Worker' : 'Main thread' }}</small>
  </div>
</template>

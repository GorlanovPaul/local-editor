<script setup lang="ts">
import { ref, reactive, watch, shallowReactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ImagePlus, ArrowUp, ArrowDown, Trash2, Download, Loader } from 'lucide-vue-next'
import { zipSync } from 'fflate'
import Ruler from '../components/Ruler.vue'
import { call, pixels, alphaCanvas } from '../ai'
import { feature, isReady, download as dlFeature, onMetered } from '../features'
import { canvas, cutout } from '../tools/image'
import { makeSticker, encodeLimited, icon100, defaultSticker } from '../tools/sticker'
import { colors } from '../state'
import { platform } from '../platform'
import { pending } from '../store'

interface It { id: number; name: string; cut: HTMLCanvasElement | null; status: string; caption: string; emoji: string; url: string; err?: string }
const router = useRouter()
const items = ref<It[]>([])
const opts = reactive(defaultSticker())
const fmt = ref<'image/webp' | 'image/png'>('image/webp')
const progress = ref(''), working = ref(false), msg = ref('')
const toast = (t: string) => { msg.value = t; setTimeout(() => msg.value === t && (msg.value = ''), 3000) }
let seq = 0
const queue: { it: It; f: Blob }[] = []
async function add(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue
    if (items.value.length >= 120) { toast('В стикерпаке максимум 120 стикеров'); break }
    const it = shallowReactive<It>({ id: ++seq, name: f.name, cut: null, status: 'В очереди', caption: '', emoji: '🙂', url: '' })
    items.value.push(it); queue.push({ it, f })
  }
  if (!working.value) run()
}
const needDl = ref(false), dlFrac = ref<number | null>(null)
async function getModel() { dlFrac.value = 0; try { await dlFeature('bg', f => dlFrac.value = f); needDl.value = false; run() } catch { toast('Не удалось скачать. Проверьте интернет') } finally { dlFrac.value = null } }
async function run() {
  if (!(await isReady('bg'))) { needDl.value = true; return }
  working.value = true
  while (queue.length) {
    const { it, f } = queue.shift()!
    try {
      it.status = 'Вырезаю…'
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as any)
      const px = pixels(bmp, 1024), img = canvas(px.w, px.h); img.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0)
      const r = await call('bg', { img: px }, (t) => { progress.value = t; it.status = t }, [px.data.buffer])
      it.cut = cutout(img, alphaCanvas(r)); it.status = ''; preview(it)
    } catch (e: any) { console.error(e); it.status = 'Не получилось'; it.err = String(e?.message || e) }
  }
  working.value = false; progress.value = ''
}
function preview(it: It) { if (it.cut) it.url = makeSticker(it.cut, { ...opts, caption: it.caption }, 256).toDataURL() }
let t: any
watch(opts, () => { clearTimeout(t); t = setTimeout(() => items.value.forEach(preview), 150) }, { deep: true })
function move(i: number, d: number) { const a = items.value, j = i + d; if (j < 0 || j >= a.length) return;[a[i], a[j]] = [a[j], a[i]]; platform.haptic() }
function del(i: number) { items.value.splice(i, 1) }
const ready = computed(() => items.value.filter(i => i.cut).length)
async function exportZip() {
  const list = items.value.filter(i => i.cut); if (!list.length) return
  working.value = true; progress.value = 'Упаковка…'
  try {
    const files: Record<string, Uint8Array> = {}, ext = fmt.value === 'image/png' ? 'png' : 'webp', emoji: string[] = []
    for (let k = 0; k < list.length; k++) {
      progress.value = `Стикер ${k + 1} из ${list.length}`
      const c = makeSticker(list[k].cut!, { ...opts, caption: list[k].caption }), b = await encodeLimited(c, fmt.value)
      const n = String(k + 1).padStart(3, '0') + '.' + (b.type === 'image/png' ? 'png' : 'webp')
      files[n] = new Uint8Array(await b.arrayBuffer()); emoji.push(`${n}\t${list[k].emoji}`)
      if (k === 0) { const ic = await encodeLimited(icon100(c), 'image/webp', 32 * 1024); files['icon_100x100.webp'] = new Uint8Array(await ic.arrayBuffer()) }
    }
    files['emoji.txt'] = new TextEncoder().encode(emoji.join('\n') + '\n')
    files['README.txt'] = new TextEncoder().encode('Стикерпак для Telegram.\n1) Откройте @Stickers, команда /newpack.\n2) Отправляйте файлы по порядку как документы (без сжатия), к каждому — эмодзи из emoji.txt.\n3) /publish, иконка — icon_100x100.webp.\nФормат: ' + ext + ', одна сторона 512 px, ≤512 КБ.\n')
    const zip = zipSync(files, { level: 0 })
    await platform.saveFile(new Blob([zip as BlobPart], { type: 'application/zip' }), 'stickerpack.zip'); platform.haptic('success'); toast('ZIP сохранён')
  } catch (e: any) { toast('Ошибка: ' + (e?.message || e)) } finally { working.value = false; progress.value = '' }
}
if (pending.value) { const f = pending.value.files; pending.value = null; add(f) }
</script>
<template>
  <div class="page">
    <header class="top"><button class="ib" @click="router.push('/')" aria-label="Назад"><ChevronLeft :size="26" /></button><b>Стикерпак</b>
      <button class="pill" :disabled="!ready || working" @click="exportZip"><Download :size="17" />ZIP</button></header>
    <div class="scroll">
      <label class="drop" @dragover.prevent @drop.prevent="add(($event as DragEvent).dataTransfer!.files)">
        <ImagePlus :size="28" /><b>Добавить фото</b><small>Можно выбрать сразу много — фон уберётся сам</small>
        <input type="file" accept="image/*" multiple hidden @change="add(($event.target as HTMLInputElement).files!); ($event.target as HTMLInputElement).value = ''" />
      </label>
      <div v-if="needDl" class="need"><b>Нужно скачать функцию удаления фона</b><small>Один раз ≈ {{ feature('bg').mb }} МБ, потом работает без интернета.<template v-if="onMetered()"> Похоже, вы не в Wi-Fi.</template></small>
        <button class="pill" :disabled="dlFrac != null" @click="getModel">{{ dlFrac != null ? `Скачиваю ${Math.round(dlFrac * 100)}%` : 'Скачать' }}</button></div>
      <p v-if="progress" class="note"><Loader :size="14" class="spin" /> {{ progress }}</p>
      <div v-if="items.length" class="opts">
        <Ruler v-model="opts.outline" :min="0" :max="20" :def="6" label="Обводка" />
        <div class="chips sw"><button v-for="c in colors" :key="c" class="swatch" :class="{ on: opts.color === c }" :style="{ background: c }" @click="opts.color = c" /></div>
        <Ruler v-model="opts.shadow" :min="0" :max="100" :def="40" label="Тень" />
        <div class="chips"><button class="chip" :class="{ on: fmt === 'image/webp' }" @click="fmt = 'image/webp'">WebP</button><button class="chip" :class="{ on: fmt === 'image/png' }" @click="fmt = 'image/png'">PNG</button></div>
      </div>
      <TransitionGroup name="list" tag="div" class="grid">
        <div v-for="(it, i) in items" :key="it.id" class="card">
          <div class="pv"><img v-if="it.url" :src="it.url" alt="" /><span v-else :title="it.err">{{ it.status }}</span></div>
          <div class="meta">
            <input class="emo" v-model="it.emoji" maxlength="4" aria-label="Эмодзи" />
            <input class="tin" v-model="it.caption" placeholder="Подпись" maxlength="24" @change="preview(it)" />
          </div>
          <div class="acts">
            <button class="ib sm" @click="move(i, -1)" :disabled="i === 0" aria-label="Выше"><ArrowUp :size="16" /></button>
            <button class="ib sm" @click="move(i, 1)" :disabled="i === items.length - 1" aria-label="Ниже"><ArrowDown :size="16" /></button>
            <button class="ib sm" @click="del(i)" aria-label="Удалить"><Trash2 :size="16" /></button>
          </div>
        </div>
      </TransitionGroup>
      <p class="note">{{ ready }} / {{ items.length }} готово · 512 px · ≤512 КБ · иконка 100×100 · emoji.txt</p>
    </div>
    <Transition name="fade"><div v-if="msg" class="toast">{{ msg }}</div></Transition>
  </div>
</template>
<style scoped>
.page{display:flex;flex-direction:column;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.top b{font-size:17px}
.scroll{flex:1;overflow-y:auto;padding:8px 14px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;max-width:720px;width:100%;margin:0 auto}
.drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px;border:1.5px dashed var(--fg3);border-radius:22px;cursor:pointer;text-align:center;color:var(--fg)}
.drop small{color:var(--fg2)}
.opts{display:flex;flex-direction:column;gap:6px;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.card{background:var(--chip);border-radius:18px;padding:8px;display:flex;flex-direction:column;gap:6px}
.pv{aspect-ratio:1;border-radius:12px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#8883 0 25%,transparent 0 50%) 0 0/14px 14px;font-size:12px;color:var(--fg2)}
.pv img{max-width:100%;max-height:100%}
.meta{display:flex;gap:6px}.emo{width:44px;text-align:center;font-size:20px;border:0;border-radius:10px;background:var(--chip);color:var(--fg)}
.meta .tin{padding:6px 10px;font-size:14px;border-radius:10px;min-width:0}
.need{display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center;padding:14px;border-radius:18px;background:var(--chip)}.need small{color:var(--fg2)}
.acts{display:flex;justify-content:space-between}
.spin{animation:spin 1s linear infinite;vertical-align:-2px}
.list-move{transition:transform .25s}
</style>

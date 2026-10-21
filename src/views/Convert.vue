<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ImagePlus, Download, Trash2 } from 'lucide-vue-next'
import { zipSync } from 'fflate'
import Ruler from '../components/Ruler.vue'
import { canvas, toBlob } from '../tools/image'
import { platform } from '../platform'
import { pending } from '../store'
interface F { id: number; file: File; out?: Blob; w?: number; h?: number; err?: string }
const router = useRouter()
const files = ref<F[]>([]), busy = ref(''), msg = ref('')
const o = reactive({ type: 'image/jpeg', quality: 82, max: 0 })
let seq = 0
const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)
function add(list: FileList | File[]) { for (const f of Array.from(list)) if (f.type.startsWith('image/') || isHeic(f)) files.value.push({ id: ++seq, file: f }) }
async function decode(f: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(f, { imageOrientation: 'from-image' } as any) } catch (e) {
    if (!isHeic(f)) throw e
    busy.value = 'Загрузка HEIC-декодера…'
    const heic2any = (await import('heic2any')).default
    const b = await heic2any({ blob: f, toType: 'image/png' }) as Blob
    return createImageBitmap(Array.isArray(b) ? b[0] : b)
  }
}
async function convertAll() {
  for (let i = 0; i < files.value.length; i++) {
    const it = files.value[i]; busy.value = `Обработка ${i + 1} из ${files.value.length}`
    try {
      const b = await decode(it.file), s = o.max ? Math.min(1, o.max / Math.max(b.width, b.height)) : 1
      const c = canvas(b.width * s, b.height * s), x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'
      if (o.type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height) }
      x.drawImage(b, 0, 0, c.width, c.height) // re-encode via canvas = EXIF/GPS/metadata removed
      it.out = await toBlob(c, o.type, o.quality / 100); it.w = c.width; it.h = c.height; it.err = undefined
    } catch (e: any) { it.err = 'Не удалось открыть' }
    files.value = [...files.value]
  }
  busy.value = ''; platform.haptic('success')
}
const ext = (t: string) => t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg'
const name = (it: F) => it.file.name.replace(/\.[^.]+$/, '') + '.' + ext(it.out!.type)
const done = computed(() => files.value.filter(f => f.out))
const totIn = computed(() => done.value.reduce((a, f) => a + f.file.size, 0)), totOut = computed(() => done.value.reduce((a, f) => a + f.out!.size, 0))
const fmt = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.round(n / 1024) + ' КБ'
async function save() {
  if (done.value.length === 1) return platform.saveFile(done.value[0].out!, name(done.value[0]))
  const z: Record<string, Uint8Array> = {}, used = new Set<string>()
  for (const f of done.value) { let n = name(f), k = 1; while (used.has(n)) n = n.replace(/(\.\w+)$/, `-${k++}$1`); used.add(n); z[n] = new Uint8Array(await f.out!.arrayBuffer()) }
  await platform.saveFile(new Blob([zipSync(z, { level: 0 }) as BlobPart], { type: 'application/zip' }), 'converted.zip')
}
if (pending.value) { add(pending.value.files); pending.value = null }
</script>
<template>
  <div class="page">
    <header class="top"><button class="ib" @click="router.push('/')" aria-label="Назад"><ChevronLeft :size="26" /></button><b>Сжать / конвертировать</b><span style="width:44px" /></header>
    <div class="scroll">
      <label class="drop" @dragover.prevent @drop.prevent="add(($event as DragEvent).dataTransfer!.files)">
        <ImagePlus :size="28" /><b>Добавить фото</b><small>JPEG, PNG, WebP, AVIF, HEIC. Метаданные (EXIF, GPS) удаляются.</small>
        <input type="file" accept="image/*,.heic,.heif" multiple hidden @change="add(($event.target as HTMLInputElement).files!); ($event.target as HTMLInputElement).value = ''" />
      </label>
      <label class="lbl">Формат</label>
      <div class="chips"><button v-for="t in [['image/jpeg','JPEG'],['image/webp','WebP'],['image/png','PNG']]" :key="t[0]" class="chip" :class="{ on: o.type === t[0] }" @click="o.type = t[0]">{{ t[1] }}</button></div>
      <Ruler v-if="o.type !== 'image/png'" v-model="o.quality" :min="10" :max="100" :def="82" label="Качество" />
      <label class="lbl">Макс. сторона</label>
      <div class="chips"><button v-for="m in [0, 4096, 2048, 1600, 1280, 1080]" :key="m" class="chip" :class="{ on: o.max === m }" @click="o.max = m">{{ m || 'Оригинал' }}</button></div>
      <div class="list">
        <div v-for="(f, i) in files" :key="f.id" class="li"><span class="n">{{ f.file.name }}</span>
          <small>{{ fmt(f.file.size) }}<template v-if="f.out"> → <b>{{ fmt(f.out.size) }}</b> · {{ f.w }}×{{ f.h }}</template><template v-if="f.err"> · {{ f.err }}</template></small>
          <button class="ib sm" @click="files.splice(i, 1)" aria-label="Убрать"><Trash2 :size="15" /></button></div>
      </div>
      <p v-if="busy" class="note">{{ busy }}</p>
      <p v-if="done.length" class="note">Итого: {{ fmt(totIn) }} → {{ fmt(totOut) }} ({{ Math.round((1 - totOut / totIn) * 100) }}% экономии)</p>
      <div class="row">
        <button class="pill wide alt" :disabled="!files.length || !!busy" @click="convertAll">Конвертировать</button>
        <button class="pill wide" :disabled="!done.length || !!busy" @click="save"><Download :size="18" />{{ done.length > 1 ? 'ZIP' : 'Сохранить' }}</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.page{display:flex;flex-direction:column;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.scroll{flex:1;overflow-y:auto;padding:8px 14px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;max-width:640px;width:100%;margin:0 auto}
.drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px;border:1.5px dashed var(--fg3);border-radius:22px;cursor:pointer;text-align:center}.drop small{color:var(--fg2)}
.list{display:flex;flex-direction:column;gap:4px}.li{display:flex;align-items:center;gap:8px;padding:8px 6px 8px 12px;background:var(--chip);border-radius:14px}
.li .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.li small{color:var(--fg2);white-space:nowrap}
</style>

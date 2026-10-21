<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, Download, Trash2, Check, ChevronDown } from 'lucide-vue-next'
import { features, status, refresh, download, remove, removeAll, settings, setInpaint, onMetered, fmtMB, type FeatureId } from '../features'
import { cancelAI } from '../ai'
const router = useRouter()
const err = ref(''), persisted = ref<boolean | null>(null), quota = ref<{ usage: number; quota: number } | null>(null)
const more = ref(false)
async function upd() { await refresh(); const e = await navigator.storage?.estimate?.(); if (e) quota.value = { usage: e.usage || 0, quota: e.quota || 0 } }
onMounted(async () => { await upd(); persisted.value = (await navigator.storage?.persisted?.()) ?? null })
const total = computed(() => features.reduce((a, f) => a + (status[f.id]?.ready ? status[f.id].bytes : 0), 0))
async function get(id: FeatureId) { err.value = ''; try { await download(id); persisted.value = (await navigator.storage?.persisted?.()) ?? null } catch { err.value = 'Не удалось скачать. Проверьте интернет и попробуйте ещё раз' } upd() }
async function getAll() { for (const f of features) if (!status[f.id]?.ready) await get(f.id) }
async function del(id: FeatureId) { cancelAI(); await remove(id); upd() }
async function delAll() { if (!confirm('Удалить все скачанные умные функции? Их можно будет скачать снова.')) return; cancelAI(); await removeAll(); upd() }
const label = (id: FeatureId) => { const s = status[id]; if (!s) return '…'; if (s.ready) return 'Готово офлайн'; if (s.frac != null) return `Скачивается ${Math.round(s.frac * 100)}%`; return 'Не скачано' }
const allReady = computed(() => features.every(f => status[f.id]?.ready))
const need = computed(() => features.filter(f => !status[f.id]?.ready).reduce((a, f) => a + f.mb, 0))
</script>
<template>
  <div class="page">
    <header class="top"><button class="ib" @click="router.push('/')" aria-label="Назад"><ChevronLeft :size="26" /></button><b>Настройки</b><span style="width:44px" /></header>
    <div class="scroll">
      <h2>Умные функции</h2>
      <p class="sub">Работают прямо на устройстве. Скачайте заранее — и пользуйтесь без интернета.</p>
      <p v-if="onMetered()" class="warn">Похоже, вы не в Wi-Fi — скачивание расходует мобильный трафик.</p>
      <div class="list">
        <div v-for="f in features" :key="f.id" class="li">
          <div class="t"><b>{{ f.name }}</b><small>{{ f.desc }} · ≈ {{ f.mb }} МБ</small>
            <span class="st" :class="{ ok: status[f.id]?.ready }"><Check v-if="status[f.id]?.ready" :size="13" />{{ label(f.id) }}</span>
            <div v-if="status[f.id]?.frac != null && !status[f.id]?.ready" class="bar"><i :style="{ width: (status[f.id].frac || 0) * 100 + '%' }" /></div></div>
          <button v-if="status[f.id]?.ready" class="ib sm" @click="del(f.id)" aria-label="Удалить"><Trash2 :size="17" /></button>
          <button v-else class="pill sm" :disabled="status[f.id]?.frac != null" @click="get(f.id)"><Download :size="15" />Скачать</button>
        </div>
      </div>
      <p v-if="err" class="warn">{{ err }}</p>
      <div class="row">
        <button class="pill wide" :disabled="allReady" @click="getAll"><Download :size="17" />{{ allReady ? 'Всё скачано' : `Скачать всё (≈ ${need} МБ)` }}</button>
        <button class="pill wide alt" :disabled="!total" @click="delAll"><Trash2 :size="17" />Очистить всё</button>
      </div>
      <p class="sub">Занято функциями: {{ fmtMB(total) }}<template v-if="quota"> · всего приложением {{ fmtMB(quota.usage) }}</template></p>
      <p v-if="persisted === false" class="sub small">Браузер может удалить скачанное при нехватке места. Установите приложение на главный экран, чтобы этого не случилось.</p>

      <h2>Удаление объектов</h2>
      <div class="chips"><button class="chip" :class="{ on: settings.inpaint === 'quality' }" @click="setInpaint('quality')">Качество</button><button class="chip" :class="{ on: settings.inpaint === 'fast' }" @click="setInpaint('fast')">Быстро</button></div>
      <p class="sub small">«Качество» лучше восстанавливает фон, «Быстро» — легче и быстрее.</p>

      <button class="more" @click="more = !more"><ChevronDown :size="16" :style="{ transform: more ? 'rotate(180deg)' : '' }" />Подробнее</button>
      <div v-if="more" class="tech">
        <p v-for="f in features" :key="f.id"><b>{{ f.name }}</b>: {{ f.tech }}, лицензия {{ f.license }}</p>
        <p>Движок: Transformers.js 4.3 и ONNX Runtime Web (WebGPU, при ошибке — WASM), загружаются с jsDelivr и кэшируются.</p>
        <p>Модели хранятся в Cache Storage браузера; фото не отправляются на сервер.</p>
      </div>
    </div>
  </div>
</template>
<style scoped>
.page{display:flex;flex-direction:column;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.scroll{flex:1;overflow-y:auto;padding:4px 16px calc(24px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;max-width:640px;width:100%;margin:0 auto}
h2{margin:12px 0 0;font-size:20px}.sub{margin:0;color:var(--fg2);font-size:14px}.small{font-size:12.5px}.warn{margin:0;color:#ff9f0a;font-size:14px}
.list{display:flex;flex-direction:column;gap:6px}
.li{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-radius:16px;background:var(--chip)}
.t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.t small{color:var(--fg2);font-size:12.5px}
.st{font-size:12px;color:var(--fg2);display:flex;align-items:center;gap:3px}.st.ok{color:#30d158}
.bar{height:3px;background:var(--chip2);border-radius:2px;overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:var(--accent)}
.more{display:flex;align-items:center;gap:6px;color:var(--fg2);font-size:14px;padding:8px 0;align-self:flex-start}
.tech{font-size:12.5px;color:var(--fg2)}.tech p{margin:0 0 6px}
</style>

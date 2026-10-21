<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { X } from 'lucide-vue-next'
import { pending } from './store'
const { needRefresh, updateServiceWorker } = useRegisterSW()
const router = useRouter()
function open(files: File[]) { if (!files.length) return; pending.value = { files }; router.push(files.length > 1 ? '/pack' : '/edit/edit') }
onMounted(async () => {
  const base = import.meta.env.BASE_URL
  if (location.search.includes('shared=1') && 'caches' in window) {
    const c = await caches.open('local-editor-share'), url = new URL('shared-image', location.origin + base).href, r = await c.match(url)
    window.history.replaceState(null, '', base + location.hash)
    if (r) { const b = await r.blob(); await c.delete(url); open([new File([b], decodeURIComponent(r.headers.get('X-Name') || 'shared'), { type: b.type })]) }
  }
  ;(window as any).launchQueue?.setConsumer(async (p: any) => { const fs: File[] = []; for (const h of p.files || []) fs.push(await h.getFile()); open(fs) })
})
</script>
<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="page" mode="out-in"><component :is="Component" :key="route.path" /></Transition>
  </RouterView>
  <Transition name="fade"><div v-if="needRefresh" class="update">Доступна новая версия
    <button class="pill sm" @click="updateServiceWorker(true)">Обновить</button>
    <button class="ib sm" @click="needRefresh = false" aria-label="Закрыть"><X :size="16" /></button></div></Transition>
</template>

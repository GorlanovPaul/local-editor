<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ImagePlus, Image, SlidersHorizontal, Scissors, Sticker, Layers, Eraser, Pipette, Sparkles, LayoutGrid, Type, CircleUser, FileDown, Ratio } from 'lucide-vue-next'
const I: Record<string, any> = { ImagePlus, Image, SlidersHorizontal, Scissors, Sticker, Layers, Eraser, Pipette, Sparkles, LayoutGrid, Type, CircleUser, FileDown, Ratio }
import { scenarios } from '../scenarios'
import { platform } from '../platform'
import { pending } from '../store'
const router = useRouter()
const icon = (n: string) => I[n] || Image
function go(s: typeof scenarios[number]) { if (s.soon) return; platform.haptic(); router.push(s.route) }
function quick(e: Event) { const i = e.target as HTMLInputElement; if (i.files?.length) { pending.value = { files: Array.from(i.files) }; router.push('/edit/edit') } i.value = '' }
</script>
<template>
  <div class="home">
    <header><div class="brand"><span class="dot" />Local Editor</div><small>Всё на устройстве · офлайн</small></header>
    <h1>Что хотите сделать?</h1>
    <label class="quick"><ImagePlus :size="22" /><span>Открыть фото</span><input type="file" accept="image/*" hidden @change="quick" /></label>
    <div class="cards">
      <button v-for="s in scenarios" :key="s.id" class="card" :class="{ soon: s.soon }" @click="go(s)">
        <span class="ic"><component :is="icon(s.icon)" :size="22" :stroke-width="1.8" /></span>
        <b>{{ s.title }}</b><small>{{ s.desc }}</small>
        <em v-if="s.soon">скоро</em><em v-else-if="s.tag" class="ai">{{ s.tag }}</em>
      </button>
    </div>
    <p class="foot">Фото не покидают устройство. Модели ИИ загружаются один раз при первом использовании.</p>
  </div>
</template>
<style scoped>
.home{height:100dvh;overflow-y:auto;padding:calc(14px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));max-width:760px;margin:0 auto;-webkit-user-select:none;user-select:none}
header{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px}.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
header small{color:var(--fg2)}
h1{font-size:30px;letter-spacing:-.03em;margin:22px 0 14px;font-weight:750}
.quick{display:flex;align-items:center;justify-content:center;gap:10px;height:56px;border-radius:28px;background:var(--accent);color:var(--accentfg);font-weight:600;font-size:17px;cursor:pointer;margin-bottom:16px;transition:transform .1s}
.quick:active{transform:scale(.97)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.card{position:relative;text-align:left;display:flex;flex-direction:column;gap:4px;padding:14px;border-radius:20px;background:var(--chip);min-height:118px;transition:transform .12s,background .15s}
.card:active{transform:scale(.97);background:var(--chip2)}
.card .ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--chip2);margin-bottom:6px;color:var(--accent)}
.card b{font-size:15px;line-height:1.2}.card small{color:var(--fg2);font-size:12.5px;line-height:1.25}
.card em{position:absolute;top:12px;right:12px;font-style:normal;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:8px;background:var(--chip2);color:var(--fg2)}
.card em.ai{background:var(--accent);color:var(--accentfg)}
.card.soon{opacity:.5;cursor:default}
.foot{color:var(--fg3);font-size:12px;text-align:center;margin-top:20px}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
const p = withDefaults(defineProps<{ modelValue: number; min: number; max: number; label?: string; def?: number; unit?: string; step?: number }>(), { def: 0, unit: '', step: 1 })
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void; (e: 'commit'): void }>()
const ppu = computed(() => Math.max(2, 520 / (p.max - p.min)))
const minor = computed(() => (p.max - p.min) / 40 * ppu.value)
const active = ref(false)
let sx = 0, v0 = 0
const buzz = () => navigator.vibrate?.(6)
function down(e: PointerEvent) { (e.currentTarget as Element).setPointerCapture(e.pointerId); sx = e.clientX; v0 = p.modelValue; active.value = true }
function move(e: PointerEvent) {
  if (!active.value) return
  let v = v0 - (e.clientX - sx) / ppu.value
  v = Math.round(Math.min(p.max, Math.max(p.min, v)) / p.step) * p.step
  if (Math.abs(v - p.def) < (p.max - p.min) * 0.012) v = p.def
  if (v !== p.modelValue) { if (v === p.def || v === p.min || v === p.max) buzz(); emit('update:modelValue', v) }
}
function up() { if (active.value) { active.value = false; emit('commit') } }
function reset() { if (p.modelValue !== p.def) { buzz(); emit('update:modelValue', p.def); emit('commit') } }
function key(e: KeyboardEvent) {
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (!d) return
  e.preventDefault(); emit('update:modelValue', Math.min(p.max, Math.max(p.min, p.modelValue + d * p.step * (e.shiftKey ? 10 : 1)))); emit('commit')
}
const off = computed(() => (p.modelValue - p.min) * ppu.value)
const fmt = computed(() => (p.modelValue > 0 && p.min < 0 ? '+' : '') + (Number.isInteger(p.modelValue) ? p.modelValue : p.modelValue.toFixed(1)) + p.unit)
</script>
<template>
  <div class="ruler" :class="{ active }">
    <button class="rv" @click="reset" :title="'Сбросить'"><small v-if="label">{{ label }}</small><b>{{ fmt }}</b></button>
    <div class="track" tabindex="0" role="slider" :aria-valuenow="modelValue" :aria-valuemin="min" :aria-valuemax="max" :aria-label="label"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key">
      <div class="ticks" :style="{ transform: `translateX(${-off}px)`, width: (max - min) * ppu + 'px', backgroundSize: `${minor}px 12px, ${minor * 5}px 100%` }">
        <i class="defdot" :style="{ left: (def - min) * ppu + 'px' }" />
        <i class="fill" :style="{ left: Math.min(def, modelValue) * ppu - min * ppu + 'px', width: Math.abs(modelValue - def) * ppu + 'px' }" />
      </div>
      <i class="needle" />
    </div>
  </div>
</template>
<style scoped>
.ruler{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;user-select:none}
.rv{background:none;border:0;color:var(--fg);display:flex;gap:8px;align-items:baseline;padding:2px 10px;min-height:28px;font:inherit;cursor:pointer}
.rv small{color:var(--fg2);font-size:13px}.rv b{font-variant-numeric:tabular-nums;font-size:15px;min-width:3ch}
.track{position:relative;width:100%;height:40px;overflow:hidden;touch-action:none;cursor:ew-resize;outline:none;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent)}
.ticks{position:absolute;left:50%;top:8px;height:24px;
  background-image:linear-gradient(90deg,var(--fg3) 1px,transparent 1px),linear-gradient(90deg,var(--fg2) 1.5px,transparent 1.5px);
  background-repeat:repeat-x;background-position:0 6px,0 0;transition:transform .05s linear}
.ruler:not(.active) .ticks{transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.defdot{position:absolute;top:-7px;width:5px;height:5px;margin-left:-2px;border-radius:50%;background:var(--fg2)}
.fill{position:absolute;bottom:-5px;height:3px;background:var(--accent);border-radius:2px}
.needle{position:absolute;left:50%;top:2px;bottom:2px;width:2px;margin-left:-1px;background:var(--accent);border-radius:1px}
</style>

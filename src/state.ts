export interface Adjust {
  exposure: number; brightness: number; contrast: number; highlights: number; shadows: number
  saturation: number; vibrance: number; warmth: number; tint: number
  sharpness: number; vignette: number; grain: number; blur: number
}
export type AdjKey = keyof Adjust
export interface Geo { rot: number; flipH: boolean; flipV: boolean; angle: number; crop: { x: number; y: number; w: number; h: number }; aspect: string }
export interface TextItem { id: string; type: 'text'; text: string; x: number; y: number; size: number; rot: number; color: string; font: string; bg: boolean }
export interface StickerItem { id: string; type: 'sticker'; text: string; x: number; y: number; size: number; rot: number }
export type Item = TextItem | StickerItem
export interface Stroke { color: string; width: number; erase: boolean; pts: number[] }
export interface Frame { kind: string; size: number; color: string }
export interface Bg { mode: 'off' | 'transparent' | 'color' | 'blur'; color: string; blur: number; ver: number }
export interface Recolor { mask: number; color: string; amount: number }
export interface EditState { src: number; recolor: Recolor; bg: Bg; geo: Geo; adj: Adjust; filter: { id: string; strength: number }; items: Item[]; strokes: Stroke[]; frame: Frame }

export const zeroAdj = (): Adjust => ({ exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, vibrance: 0, warmth: 0, tint: 0, sharpness: 0, vignette: 0, grain: 0, blur: 0 })
export const defaultState = (): EditState => ({
  src: 0, recolor: { mask: 0, color: '#ff3b30', amount: 100 },
  bg: { mode: 'off', color: '#ffffff', blur: 50, ver: 0 },
  geo: { rot: 0, flipH: false, flipV: false, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, aspect: 'free' },
  adj: zeroAdj(), filter: { id: 'none', strength: 100 }, items: [], strokes: [], frame: { kind: 'none', size: 30, color: '#ffffff' },
})

export const adjTools: { k: AdjKey; l: string; min: number; max: number }[] = [
  { k: 'exposure', l: 'Экспозиция', min: -100, max: 100 }, { k: 'brightness', l: 'Яркость', min: -100, max: 100 },
  { k: 'contrast', l: 'Контраст', min: -100, max: 100 }, { k: 'highlights', l: 'Света', min: -100, max: 100 },
  { k: 'shadows', l: 'Тени', min: -100, max: 100 }, { k: 'saturation', l: 'Насыщенность', min: -100, max: 100 },
  { k: 'vibrance', l: 'Сочность', min: -100, max: 100 }, { k: 'warmth', l: 'Теплота', min: -100, max: 100 },
  { k: 'tint', l: 'Оттенок', min: -100, max: 100 }, { k: 'sharpness', l: 'Резкость', min: 0, max: 100 },
  { k: 'vignette', l: 'Виньетка', min: -100, max: 100 }, { k: 'grain', l: 'Зерно', min: 0, max: 100 },
  { k: 'blur', l: 'Размытие', min: 0, max: 100 },
]

export interface FilterDef { id: string; l: string; a?: Partial<Adjust>; mono?: number; fade?: number; sh?: [number, number, number]; hi?: [number, number, number] }
export const filters: FilterDef[] = [
  { id: 'none', l: 'Оригинал' },
  { id: 'vivid', l: 'Яркий', a: { saturation: 25, vibrance: 25, contrast: 15 } },
  { id: 'warm', l: 'Тёплый', a: { warmth: 35, saturation: 10, highlights: -10 } },
  { id: 'cool', l: 'Холодный', a: { warmth: -30, tint: -5, contrast: 8 } },
  { id: 'bw', l: 'Ч/Б', mono: 1, a: { contrast: 20 } },
  { id: 'noir', l: 'Нуар', mono: 1, a: { contrast: 45, exposure: -10, vignette: 40 } },
  { id: 'vintage', l: 'Винтаж', fade: 0.5, a: { warmth: 20, saturation: -20, grain: 20 }, sh: [0.05, 0.02, 0] },
  { id: 'film', l: 'Плёнка', fade: 0.3, a: { contrast: 10, grain: 25 }, sh: [0, 0.03, 0.05], hi: [0.05, 0.03, 0] },
  { id: 'sepia', l: 'Сепия', mono: 1, hi: [0.08, 0.04, -0.02], sh: [0.04, 0.01, -0.03] },
  { id: 'drama', l: 'Драма', a: { contrast: 35, shadows: 25, highlights: -30, saturation: -10, vignette: 30 } },
  { id: 'pastel', l: 'Пастель', fade: 0.4, a: { saturation: -15, brightness: 10, contrast: -15 } },
  { id: 'sunset', l: 'Закат', a: { warmth: 40, tint: 10, saturation: 15 }, hi: [0.06, 0.02, 0] },
]

export const aspects = [
  { id: 'free', l: 'Свободно' }, { id: 'orig', l: 'Оригинал' }, { id: '1:1', l: '1:1' }, { id: '4:5', l: '4:5' },
  { id: '3:4', l: '3:4' }, { id: '9:16', l: '9:16' }, { id: '16:9', l: '16:9' },
]
export const frames = [
  { id: 'none', l: 'Нет' }, { id: 'border', l: 'Рамка' }, { id: 'polaroid', l: 'Полароид' },
  { id: 'rounded', l: 'Скругление' }, { id: 'line', l: 'Линия' }, { id: 'film', l: 'Плёнка' }, { id: 'circle', l: 'Круг' },
]
export const fonts = [
  { id: 'system-ui, sans-serif', l: 'Обычный' }, { id: 'Georgia, serif', l: 'Антиква' },
  { id: '"Courier New", monospace', l: 'Моно' }, { id: '"Comic Sans MS", "Segoe Print", cursive', l: 'Рукопись' },
  { id: 'Impact, "Arial Black", sans-serif', l: 'Плакат' },
]
export const colors = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d55']
export const emojis = ['😀', '😂', '😍', '😎', '🥳', '😱', '🤔', '👍', '❤️', '🔥', '⭐', '✨', '🎉', '🌸', '🌈', '☀️', '🌙', '⚡', '💯', '🐱', '🐶', '🦄', '🍕', '☕', '🎈', '📍', '✅', '❗', '💬', '👑']

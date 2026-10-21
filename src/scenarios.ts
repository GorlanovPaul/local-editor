/** Ready-made scenarios on the home screen. `route` picks the module; `preset` configures the editor. */
export interface EditorPreset {
  tab?: string; aiTool?: string; auto?: 'bg' | 'enhance'; aspect?: string; frame?: string; frameColor?: string
  sticker?: boolean; social?: boolean; export?: { size?: number; type?: string; w?: number; h?: number }
}
export interface Scenario { id: string; title: string; desc: string; icon: string; route: string; preset?: EditorPreset; soon?: boolean; tag?: string }
export const scenarios: Scenario[] = [
  { id: 'edit', title: 'Редактировать фото', desc: 'Свет, цвет, кадр, фильтры', icon: 'SlidersHorizontal', route: '/edit/edit', preset: { tab: 'adjust' } },
  { id: 'bg', title: 'Убрать фон', desc: 'Прозрачный, цвет или размытие', icon: 'Scissors', route: '/edit/bg', preset: { tab: 'ai', aiTool: 'bg', auto: 'bg', export: { type: 'image/png' } }, tag: 'ИИ' },
  { id: 'sticker', title: 'Стикер для Telegram', desc: 'Вырезка, обводка, 512 px', icon: 'Sticker', route: '/edit/sticker', preset: { tab: 'sticker', auto: 'bg', sticker: true }, tag: 'ИИ' },
  { id: 'pack', title: 'Стикерпак', desc: 'Много фото → ZIP для @Stickers', icon: 'Layers', route: '/pack', tag: 'ИИ' },
  { id: 'erase', title: 'Удалить объект', desc: 'Закрасьте лишнее — исчезнет', icon: 'Eraser', route: '/edit/erase', preset: { tab: 'ai', aiTool: 'erase' }, tag: 'ИИ' },
  { id: 'recolor', title: 'Перекрасить объект', desc: 'Коснитесь и выберите цвет', icon: 'Pipette', route: '/edit/recolor', preset: { tab: 'ai', aiTool: 'obj' }, tag: 'ИИ' },
  { id: 'enhance', title: 'Улучшить качество', desc: 'Автоулучшение и увеличение ×2/×4', icon: 'Sparkles', route: '/edit/enhance', preset: { tab: 'ai', aiTool: 'up', auto: 'enhance' }, tag: 'ИИ' },
  { id: 'collage', title: 'Коллаж', desc: 'Сетки, отступы, скругления', icon: 'LayoutGrid', route: '/collage', soon: true },
  { id: 'meme', title: 'Мем / текст на фото', desc: 'Подписи сверху и снизу', icon: 'Type', route: '/edit/meme', preset: { tab: 'text' } },
  { id: 'avatar', title: 'Аватарка', desc: 'Круг, новый фон, обводка', icon: 'CircleUser', route: '/edit/avatar', preset: { tab: 'crop', aspect: '1:1', frame: 'circle', frameColor: '', export: { size: 1080, type: 'image/png' } } },
  { id: 'compress', title: 'Сжать / конвертировать', desc: 'Пакетно, без EXIF, HEIC → JPEG', icon: 'FileDown', route: '/convert', soon: true },
  { id: 'social', title: 'Размер для соцсетей', desc: 'Instagram, Telegram, VK, YouTube', icon: 'Ratio', route: '/edit/social', preset: { tab: 'crop', social: true } },
]
export const socialPresets = [
  { id: 'ig-post', l: 'Instagram пост 4:5', w: 1080, h: 1350 }, { id: 'ig-sq', l: 'Instagram 1:1', w: 1080, h: 1080 },
  { id: 'ig-story', l: 'Stories / Reels', w: 1080, h: 1920 }, { id: 'tg-post', l: 'Telegram пост', w: 1280, h: 1280 },
  { id: 'tg-story', l: 'Telegram история', w: 1080, h: 1920 }, { id: 'vk-post', l: 'VK пост', w: 1080, h: 1080 },
  { id: 'vk-cover', l: 'VK обложка', w: 1590, h: 530 }, { id: 'yt-thumb', l: 'YouTube превью', w: 1280, h: 720 },
  { id: 'yt-banner', l: 'YouTube баннер', w: 2560, h: 1440 },
]

import type { Platform } from './types'
export const web: Platform = {
  name: 'web',
  async saveFile(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000) },
  canShareFiles(files) { return !!navigator.canShare?.({ files }) },
  async shareFiles(files, title) { await navigator.share({ files, title }) },
  haptic(kind = 'light') { navigator.vibrate?.(kind === 'light' ? 6 : kind === 'medium' ? 12 : kind === 'success' ? [10, 40, 10] : [30, 30, 30]) },
  setBackButton() { /* browser back is native */ },
  isDark() { return matchMedia('(prefers-color-scheme: dark)').matches },
}

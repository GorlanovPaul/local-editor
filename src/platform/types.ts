/** Platform abstraction: web now, Telegram Mini App later (src/platform/telegram.ts). */
export interface Platform {
  name: 'web' | 'telegram'
  saveFile(blob: Blob, name: string): Promise<void>
  canShareFiles(files: File[]): boolean
  shareFiles(files: File[], title?: string): Promise<void>
  haptic(kind?: 'light' | 'medium' | 'success' | 'error'): void
  /** show a native back button (Telegram) or no-op on web; returns disposer */
  setBackButton(cb: (() => void) | null): void
  isDark(): boolean
}

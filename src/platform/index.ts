import { web } from './web'
import type { Platform } from './types'
// Later: detect window.Telegram?.WebApp and return the telegram implementation.
export const platform: Platform = web
export type { Platform }

import { shallowRef } from 'vue'
/** files handed over from share-target / file handler / home screen to a tool view */
export const pending = shallowRef<{ files: File[] } | null>(null)

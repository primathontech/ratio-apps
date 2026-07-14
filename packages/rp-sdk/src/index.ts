export { RpReturnPortal } from './portal'
export type { RpConfig, RpLineItem, RpOrder, RpReason, SelectedItem } from './types'

export function initReturnPortal(config: {
  store: string
  apiUrl: string
  targetSelector?: string
  channel?: number
  primaryColor?: string
}): void {
  const target = document.querySelector(config.targetSelector ?? '#rp-return-portal')
  if (!target) {
    console.warn('[rp-sdk] No target element found. Add <div id="rp-return-portal"></div> to your page.')
    return
  }

  const el = document.createElement('rp-return-portal')
  el.setAttribute('store', config.store)
  el.setAttribute('api-url', config.apiUrl)
  if (config.channel !== undefined) el.setAttribute('channel', String(config.channel))
  if (config.primaryColor) el.setAttribute('primary-color', config.primaryColor)

  target.replaceWith(el)
}

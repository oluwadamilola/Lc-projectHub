import { chromium } from 'playwright-core'
import { BROWSER_CHANNEL } from './config.mjs'

/** Starts the browser every suite uses (headless, installed Edge by default; see BROWSER_CHANNEL). */
export function launchBrowser() {
  return chromium.launch({ channel: BROWSER_CHANNEL, headless: true })
}

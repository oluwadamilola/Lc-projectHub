// Single source of truth for the browser-test stack: ports, addresses, repo location and browser.
// Nothing here is machine specific; the repository root is worked out from where this file lives.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** The repository root (tests/browser/lib -> three levels up). Override with TEST_REPO only if you moved this folder. */
export const REPO_ROOT = process.env.TEST_REPO ? path.resolve(process.env.TEST_REPO) : path.resolve(here, '..', '..', '..')
export const SUITE_DIR = path.resolve(here, '..')

/** The development server holds real working data. Tests must never read-write it. */
export const DEV_PORT = 4000
/** The throw-away test API (the built server, with its own in-memory seed data). */
export const API_PORT = Number(process.env.TEST_API_PORT ?? 4001)
/** The built client, served by `vite preview` with /api proxied to the TEST API. */
export const WEB_PORT = Number(process.env.TEST_WEB_PORT ?? 4173)

// Fail closed: refuse to even load with an unsafe or nonsensical port setup.
for (const [name, port] of [['TEST_API_PORT', API_PORT], ['TEST_WEB_PORT', WEB_PORT]]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be a whole number between 1024 and 65535 (got ${process.env[name]}).`)
  }
  if (port === DEV_PORT) {
    throw new Error(`${name} must not be ${DEV_PORT}: that is the development server, which tests must never use.`)
  }
}
if (API_PORT === WEB_PORT) throw new Error('TEST_API_PORT and TEST_WEB_PORT must be different.')

export const API_URL = `http://localhost:${API_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`
export const DEV_URL = `http://localhost:${DEV_PORT}`

/** Which installed browser Playwright drives. Microsoft Edge by default; set BROWSER_CHANNEL=chrome for Chrome. */
export const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL ?? 'msedge'

/** Every suite, in the order they are run. Each lives in suites/<name>.mjs. */
export const SUITES = ['dash', 'overdue', 'tasks', 'alltasks', 'editing', 'review', 'light-only']

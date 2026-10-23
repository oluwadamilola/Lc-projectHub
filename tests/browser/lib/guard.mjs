// Safety checks that every browser-test suite runs before it does anything.
//
// The development server runs on port 4000 and holds real working data. Tests must never read or write it
// by accident. These checks make that impossible to do silently:
//   1. the API address must not be port 4000, and must be on this machine;
//   2. the web address must serve /api THROUGH the isolated test stack (preview.test.config.mjs), which stamps
//      every response with "x-test-stack: 1". If that header is missing, the page would be talking to whatever
//      the default proxy points at (port 4000), so the suite refuses to run.
// Any doubt means "refuse": the guard fails closed.

import { API_URL, DEV_PORT, WEB_URL } from './config.mjs'

export const WEB = process.env.TEST_WEB ?? WEB_URL
export const API = process.env.TEST_API ?? API_URL

export async function assertIsolated({ web = WEB, api = API } = {}) {
  const fail = (why) => {
    console.error(`\nREFUSING TO RUN: ${why}\nStart the isolated stack with:  npm run test:stack   (or run suites with: npm test)\n`)
    process.exit(2)
  }
  let apiUrl
  let webUrl
  try {
    apiUrl = new URL(api)
    webUrl = new URL(web)
  } catch {
    return fail('TEST_API or TEST_WEB is not a valid address.')
  }
  if (apiUrl.port === String(DEV_PORT) || webUrl.port === String(DEV_PORT)) fail(`port ${DEV_PORT} is the development server.`)
  if (!['localhost', '127.0.0.1'].includes(apiUrl.hostname) || !['localhost', '127.0.0.1'].includes(webUrl.hostname)) {
    fail('tests may only talk to this machine.')
  }
  let response
  try {
    response = await fetch(`${web}/api/health`)
  } catch {
    fail(`nothing is answering at ${web}. Is the test stack running?`)
  }
  if (response.headers.get('x-test-stack') !== '1') {
    fail(`${web}/api is not served through the isolated test stack (missing x-test-stack header), so it may reach the development server.`)
  }
  const direct = await fetch(`${api}/api/health`).catch(() => null)
  if (!direct || !direct.ok) fail(`the test API at ${api} is not answering.`)
}

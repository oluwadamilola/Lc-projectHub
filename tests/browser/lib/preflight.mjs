// Prerequisite checks run before the test stack starts. Each failure says what is wrong and how to fix it.
// Anything that cannot be confirmed counts as a failure (fail closed): the runner starts nothing unless all pass.

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { API_PORT, BROWSER_CHANNEL, DEV_PORT, REPO_ROOT, WEB_PORT } from './config.mjs'

const require = createRequire(import.meta.url)
const MIN_NODE_MAJOR = 20

/** Tries to listen on the port on every address the stack could use. A port is free only if all of them succeed. */
export async function portStatus(port) {
  const attempts = ['127.0.0.1', '::1', undefined] // IPv4 loopback, IPv6 loopback, and "everywhere"
  for (const host of attempts) {
    const result = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', (error) => resolve({ ok: false, code: error.code }))
      server.listen({ port, host }, () => server.close(() => resolve({ ok: true })))
    })
    // A machine without IPv6 reports these codes for ::1; that is not a conflict.
    if (!result.ok && !['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(result.code)) {
      return { free: false, code: result.code, host: host ?? 'all addresses' }
    }
  }
  return { free: true }
}

async function describeListener(port) {
  const answer = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) }).then(
    (r) => `something is answering HTTP there (status ${r.status})`,
    () => 'something is holding the port but not answering HTTP',
  )
  return answer
}

function newestModified(dir) {
  let newest = 0
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (!/\.test\.tsx?$/.test(entry.name)) newest = Math.max(newest, fs.statSync(full).mtimeMs)
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return newest
}

export async function runPreflight({ checkBrowser = true } = {}) {
  const lines = []
  let failed = 0
  const ok = (text) => lines.push(`  ok    ${text}`)
  const warn = (text) => lines.push(`  warn  ${text}`)
  const bad = (text, fix) => {
    failed += 1
    lines.push(`  FAIL  ${text}`)
    lines.push(`        fix: ${fix}`)
  }

  // 1. Node
  const major = Number(process.versions.node.split('.')[0])
  if (major >= MIN_NODE_MAJOR) ok(`Node ${process.versions.node}`)
  else bad(`Node ${process.versions.node} is too old`, `install Node ${MIN_NODE_MAJOR} or newer`)

  // 2. Playwright
  let playwrightOk = false
  try {
    const version = require('playwright-core/package.json').version
    ok(`playwright-core ${version}`)
    playwrightOk = true
  } catch {
    bad('playwright-core is not installed', 'run "npm install" inside tests/browser (from the repo root: npm --prefix tests/browser install)')
  }

  // 3. Builds the stack serves
  const builds = [
    ['shared', path.join(REPO_ROOT, 'shared', 'dist', 'index.js'), path.join(REPO_ROOT, 'shared', 'src')],
    ['server', path.join(REPO_ROOT, 'server', 'dist', 'index.js'), path.join(REPO_ROOT, 'server', 'src')],
    ['client', path.join(REPO_ROOT, 'client', 'dist', 'index.html'), path.join(REPO_ROOT, 'client', 'src')],
  ]
  const missing = builds.filter(([, built]) => !fs.existsSync(built)).map(([name]) => name)
  if (missing.length > 0) {
    bad(`no build found for: ${missing.join(', ')}`, 'run "npm run build" in the repository root first')
  } else {
    ok('shared, server and client builds found')
    for (const [name, built, source] of builds) {
      if (newestModified(source) > fs.statSync(built).mtimeMs) {
        warn(`the ${name} build is older than its source; the tests would run against stale code. Run "npm run build".`)
      }
    }
  }

  // 4. Vite (used for the isolated preview)
  try {
    const vitePackage = createRequire(path.join(REPO_ROOT, 'client', 'package.json')).resolve('vite/package.json')
    ok(`vite found (${path.relative(REPO_ROOT, path.dirname(vitePackage)).replaceAll('\\', '/')})`)
  } catch {
    bad('vite is not installed', 'run "npm install" in the repository root')
  }

  // 5. Ports for the test stack. 4000 is never touched.
  for (const [label, port] of [['test API', API_PORT], ['test web', WEB_PORT]]) {
    const status = await portStatus(port)
    if (status.free) ok(`port ${port} is free (${label})`)
    else {
      bad(
        `port ${port} (${label}) is already in use (${status.code} on ${status.host}; ${await describeListener(port)})`,
        `stop whatever is using port ${port}, for example a leftover test run, or choose another with TEST_${label === 'test API' ? 'API' : 'WEB'}_PORT`,
      )
    }
  }
  ok(`development server port ${DEV_PORT} will not be used (only its project count is read, if it is running)`)

  // 6. The browser
  if (checkBrowser && playwrightOk) {
    try {
      const { chromium } = await import('playwright-core')
      const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true })
      await browser.close()
      ok(`browser "${BROWSER_CHANNEL}" launches`)
    } catch (error) {
      bad(
        `cannot launch the "${BROWSER_CHANNEL}" browser (${String(error.message).split('\n')[0]})`,
        'install Microsoft Edge, or set BROWSER_CHANNEL=chrome to use Google Chrome',
      )
    }
  }

  return { ok: failed === 0, failed, report: lines.join('\n') }
}

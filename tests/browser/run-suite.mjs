// Runs the browser regression suites against an ISOLATED stack and reports exact pass/fail counts.
//
//   node run-suite.mjs --all                 run every suite (npm test)
//   node run-suite.mjs dash tasks            run only those suites
//   node run-suite.mjs --stack-only          start the isolated stack and wait; Ctrl+C stops it (npm run test:stack)
//   --verbose                                also stream each suite's output as it runs
//
// The stack: the BUILT server (server/dist) on the test API port with its own in-memory seed data, plus the built
// client served by `vite preview` whose /api proxy points at that test server (preview.test.config.mjs).
// Each suite starts against a freshly restarted test server, so suites cannot affect one another.
//
// Safety: this never starts, stops or writes to the development server on port 4000. If something is answering there,
// its project count is READ before and after, and the run fails if the count changed. Every suite also refuses to run
// unless it can prove its web address goes through this stack (lib/guard.mjs). Any doubt means refuse (fail closed).
//
// Exit codes: 0 all suites passed and the dev server was untouched; 1 a suite failed (or the dev server changed);
//             2 a prerequisite was missing or the isolation could not be established (nothing was run).

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import path from 'node:path'
import { API_PORT, API_URL, DEV_PORT, DEV_URL, REPO_ROOT, SUITES, SUITE_DIR, WEB_PORT, WEB_URL } from './lib/config.mjs'
import { runPreflight } from './lib/preflight.mjs'

// Children run through a wrapper that exits when the pipe to this runner closes (see lib/child-wrapper.mjs).
const WRAPPER = path.join(SUITE_DIR, 'lib', 'child-wrapper.mjs')

const SUITE_TIMEOUT_MS = 10 * 60 * 1000
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const stackOnly = args.includes('--stack-only')

function usage() {
  console.log(`Usage:
  node run-suite.mjs --all                 run every suite: ${SUITES.join(', ')}
  node run-suite.mjs <suite> [<suite>...]  run only the named suites
  node run-suite.mjs --stack-only          start the isolated stack and wait (Ctrl+C to stop)
  --verbose                                stream each suite's output as it runs`)
}

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  usage()
  process.exit(args.length === 0 ? 2 : 0)
}
const requested = args.includes('--all') ? SUITES : args.filter((a) => !a.startsWith('--'))
const unknown = requested.filter((name) => !SUITES.includes(name))
if (unknown.length > 0) {
  console.error(`Unknown suite: ${unknown.join(', ')}. Available: ${SUITES.join(', ')}`)
  process.exit(2)
}

// ---------------------------------------------------------------- cleanup
// Every process this script starts is tracked and stopped on normal exit, errors, Ctrl+C and SIGTERM.
// Even if the runner is killed without a chance to run any code (for example "taskkill /F" on Windows, or SIGKILL
// elsewhere), each child exits on its own when its pipe to the runner closes (lib/child-wrapper.mjs). The next run's
// preflight still reports any port that stays occupied, so a leftover can never be mistaken for a fresh stack.
const children = new Set()
function track(child) {
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}
function killAll() {
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // already gone
    }
  }
}
process.on('exit', killAll)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    console.error(`\nReceived ${signal}: stopping the test stack...`)
    killAll()
    process.exit(130)
  })
}
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    console.error(`\nUnexpected ${event}:`, error)
    killAll()
    process.exit(1)
  })
}
function stop(code, message) {
  if (message) console.error(`\n${message}`)
  killAll()
  process.exit(code)
}

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startNode(label, script, scriptArgs, options) {
  // stdin stays an open pipe on purpose: its closing is how the wrapper learns the runner has gone.
  const child = track(spawn(process.execPath, [WRAPPER, script, ...scriptArgs], { ...options, stdio: ['pipe', 'pipe', 'pipe'] }))
  child.label = label
  child.tail = ''
  child.finished = false
  const keep = (chunk) => {
    child.tail = (child.tail + chunk).slice(-3000)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  child.once('exit', (code, signal) => {
    child.finished = true
    child.exitInfo = signal ? `signal ${signal}` : `exit code ${code}`
  })
  return child
}

async function waitUntil(check, what, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child?.finished) throw new Error(`${child.label} stopped while waiting for ${what} (${child.exitInfo}). Its last output:\n${child.tail || '(none)'}`)
    if (await check()) return
    await sleep(250)
  }
  throw new Error(`Timed out after 20s waiting for ${what}.${child ? ` ${child.label} last output:\n${child.tail || '(none)'}` : ''}`)
}

const testApiAnswers = () => fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)
const previewIsIsolated = () =>
  fetch(`${WEB_URL}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok && r.headers.get('x-test-stack') === '1', () => false)

/** READ-ONLY look at the development server: its project count, or null when it is not running. */
async function devProjectCount() {
  try {
    const response = await fetch(`${DEV_URL}/api/projects?pageSize=1`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return `unreadable (HTTP ${response.status})`
    return (await response.json()).meta.total
  } catch {
    return null
  }
}

let server
async function restartServer() {
  if (server && !server.finished) {
    server.kill()
    await once(server, 'exit')
  }
  server = startNode('The test server', path.join(REPO_ROOT, 'server', 'dist', 'index.js'), [], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(API_PORT) },
  })
  await waitUntil(testApiAnswers, 'the test server to answer', server)
}

function runSuite(name) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = track(
      spawn(process.execPath, [WRAPPER, path.join(SUITE_DIR, 'suites', `${name}.mjs`)], {
        cwd: SUITE_DIR,
        env: { ...process.env, TEST_WEB: WEB_URL, TEST_API: API_URL },
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )
    let output = ''
    let timedOut = false
    const take = (chunk) => {
      output += chunk
      if (verbose) process.stdout.write(chunk)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, SUITE_TIMEOUT_MS)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ name, code, output, timedOut, seconds: Math.round((Date.now() - started) / 1000) })
    })
  })
}

// ---------------------------------------------------------------- 1. prerequisites
console.log(`LC ProjectHub browser regression suite (repo: ${path.basename(REPO_ROOT)})\n\nPreflight`)
const preflight = await runPreflight({ checkBrowser: !stackOnly })
console.log(preflight.report)
if (!preflight.ok) stop(2, `${preflight.failed} prerequisite(s) not met. Nothing was started or run.`)

// ---------------------------------------------------------------- 2. start the isolated stack
const devBefore = await devProjectCount()
console.log(
  devBefore === null
    ? `\nDevelopment server (port ${DEV_PORT}): not running (nothing to protect).`
    : `\nDevelopment server (port ${DEV_PORT}): running with ${devBefore} projects. It will only be READ, never written.`,
)

try {
  await restartServer()
  const viteBin = path.join(path.dirname(createRequire(path.join(REPO_ROOT, 'client', 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js')
  const preview = startNode('The isolated preview', viteBin, ['preview', '--config', path.join(SUITE_DIR, 'preview.test.config.mjs')], {
    cwd: REPO_ROOT,
    env: { ...process.env, TEST_REPO: REPO_ROOT, TEST_API_PORT: String(API_PORT), TEST_WEB_PORT: String(WEB_PORT) },
  })
  await waitUntil(previewIsIsolated, 'the isolated preview to answer with the x-test-stack header', preview)
} catch (error) {
  stop(2, `Could not establish the isolated stack, so nothing was run.\n${error.message}`)
}
// Fail closed: re-prove isolation now, immediately before anything runs.
if (!(await previewIsIsolated()) || !(await testApiAnswers())) stop(2, 'Isolation could not be confirmed (missing x-test-stack header). Nothing was run.')
console.log(`Isolated stack up: web ${WEB_PORT} -> /api -> test server ${API_PORT} (x-test-stack header confirmed).`)

if (stackOnly) {
  console.log(`\nStack running. Point a browser at ${WEB_URL}. Press Ctrl+C to stop.`)
  await new Promise(() => {})
}

// ---------------------------------------------------------------- 3. run the suites
const results = []
for (const name of requested) {
  try {
    await restartServer() // fresh seed data for every suite
  } catch (error) {
    stop(2, `Could not restart the test server before "${name}".\n${error.message}`)
  }
  process.stdout.write(`Running ${name} ... `)
  const run = await runSuite(name)
  const summary = run.output.match(/(\d+)\/(\d+) checks passed/)
  const failing = run.output.split('\n').filter((line) => /^FAIL /.test(line)).map((line) => line.trim().slice(0, 170))
  const result = {
    name,
    passed: summary ? Number(summary[1]) : 0,
    total: summary ? Number(summary[2]) : 0,
    failing,
    seconds: run.seconds,
    refused: /REFUSING TO RUN/.test(run.output),
    timedOut: run.timedOut,
    crashed: !summary,
    tail: run.output.split('\n').slice(-12).join('\n'),
  }
  results.push(result)
  console.log(`${result.passed}/${result.total} (${run.seconds}s)`)
}

// ---------------------------------------------------------------- 4. report
const devAfter = await devProjectCount()
killAll()

console.log('\n================ RESULTS ================')
for (const r of results) {
  const status = r.refused ? 'REFUSED by the isolation guard' : r.timedOut ? 'TIMED OUT' : r.crashed ? 'CRASHED (no summary)' : r.passed === r.total ? 'PASS' : 'FAIL'
  console.log(`${r.name.padEnd(12)} ${String(r.passed).padStart(3)}/${String(r.total).padEnd(3)} ${status}`)
  for (const line of r.failing) console.log(`    ${line}`)
  if (r.crashed) console.log(`    last output:\n${r.tail.split('\n').map((l) => `      ${l}`).join('\n')}`)
}
const totalPassed = results.reduce((sum, r) => sum + r.passed, 0)
const totalChecks = results.reduce((sum, r) => sum + r.total, 0)
console.log(`\nTotal: ${totalPassed}/${totalChecks} checks passed across ${results.length} suite(s).`)

const devChanged = devBefore !== devAfter
console.log(`Development server (port ${DEV_PORT}) project count: before=${devBefore ?? 'not running'} after=${devAfter ?? 'not running'} -> ${devChanged ? 'CHANGED: SOMETHING WROTE TO THE DEV SERVER' : 'unchanged'}`)

const anyBad = results.some((r) => r.crashed || r.refused || r.timedOut || r.passed !== r.total)
process.exit(anyBad || devChanged ? 1 : 0)

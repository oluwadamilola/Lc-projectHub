// Static checks for the browser suite (no browser, no servers needed): npm run check
//
//  1. every script parses (node --check);
//  2. the safety rules hold, so a future edit cannot quietly reintroduce a way to reach the development server
//     or a machine-specific path.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUITES } from './lib/config.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const problems = []
const rel = (file) => path.relative(root, file).replaceAll('\\', '/')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'screenshots') return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const files = walk(root)
const scripts = files.filter((file) => file.endsWith('.mjs'))

// 1. Syntax
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' })
  if (result.status !== 0) problems.push(`${rel(file)}: does not parse\n${result.stderr.trim()}`)
}

// 2. Rules for the suites themselves
const suiteFiles = SUITES.map((name) => path.join(root, 'suites', `${name}.mjs`))
for (const file of suiteFiles) {
  if (!fs.existsSync(file)) {
    problems.push(`${rel(file)}: listed in lib/config.mjs but missing`)
    continue
  }
  const text = fs.readFileSync(file, 'utf-8')
  const name = rel(file)
  if (!/assertIsolated\(\)/.test(text)) problems.push(`${name}: never calls assertIsolated() (the isolation guard)`)
  if (!/checks passed/.test(text)) problems.push(`${name}: does not print the "N/M checks passed" summary the runner reads`)
  if (/:4000\b/.test(text)) problems.push(`${name}: mentions port 4000 (the development server)`)
  if (/localhost:\d{4}|127\.0\.0\.1:\d{4}/.test(text)) problems.push(`${name}: hard-codes a host and port; use WEB and API from lib/guard.mjs`)
  if (/route\.continue\(\s*\)/.test(text)) problems.push(`${name}: bare route.continue() skips request redirection; use route.fallback()`)
  if (/process\.argv\[/.test(text)) problems.push(`${name}: reads process.argv; screenshots must be opt-in through the SHOTS variable`)
  if (/msedge|chromium\.launch/.test(text)) problems.push(`${name}: launches a browser directly; use launchBrowser() from lib/browser.mjs`)
}

// 3. Rules for every file we ship: no machine-specific paths, names or secrets
for (const file of files.filter((f) => /\.(mjs|json|md)$/.test(f) && !f.endsWith('package-lock.json'))) {
  const text = fs.readFileSync(file, 'utf-8')
  const name = rel(file)
  if (name === 'check.mjs') continue // this file contains the patterns it searches for
  if (/\b[A-Za-z]:[\\/](Users|Windows|Program)/i.test(text) || /\/(Users|home)\/[a-z0-9._-]+\//i.test(text)) {
    problems.push(`${name}: contains an absolute, machine-specific path`)
  }
  if (/AppData|scratchpad/i.test(text)) problems.push(`${name}: refers to a scratch or temp location`)
  if (/(password|secret|api[_-]?key|bearer)\s*[:=]/i.test(text)) problems.push(`${name}: looks like it contains a credential`)
}

if (problems.length > 0) {
  console.error(`Browser suite check FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n`)
  for (const problem of problems) console.error(` - ${problem}`)
  process.exit(1)
}
console.log(`Browser suite check passed: ${scripts.length} scripts parse; ${suiteFiles.length} suites obey the isolation and portability rules.`)

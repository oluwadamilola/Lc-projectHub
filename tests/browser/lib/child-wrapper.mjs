// Runs another Node script inside this process and makes it stop when the runner goes away.
//
//   node child-wrapper.mjs <script> [args...]
//
// The runner starts the test server, the isolated preview and every suite through this wrapper and keeps the pipe to
// the wrapper's standard input open. When the runner exits for ANY reason (finished, crashed, Ctrl+C, SIGTERM, or even a
// hard kill such as "taskkill /F" that gives it no chance to clean up), the operating system closes that pipe, and this
// wrapper then exits too. That stops leftover test servers from being orphaned on ports 4001 and 4173.

import { pathToFileURL } from 'node:url'

const [script, ...scriptArgs] = process.argv.slice(2)
if (!script) {
  console.error('child-wrapper: no script given')
  process.exit(2)
}

const goAway = () => process.exit(0)
process.stdin.on('end', goAway)
process.stdin.on('close', goAway)
process.stdin.on('error', goAway)
process.stdin.resume()
// Watching the pipe must NOT keep this process alive. Without this, a script that has finished its work (a test suite)
// would wait for the runner to close the pipe and never exit. A long-running script (the server, the preview) still
// runs on its own handles and still sees the pipe close if the runner disappears.
process.stdin.unref?.()

// The wrapped script sees itself as the program that was started.
process.argv = [process.argv[0], script, ...scriptArgs]
await import(pathToFileURL(script).href)

// Vite preview configuration used ONLY by the browser-test stack (it is not part of the application).
//
// It serves the built client exactly as the real preview does, but its /api proxy points at the throw-away TEST
// server, never at the development server on port 4000. Every proxied response is also stamped with
// "x-test-stack: 1" so the test suites can prove, before they do anything, that the page they are about to drive
// really is wired to the test server.
//
// It is started by run-suite.mjs, which supplies TEST_REPO, TEST_API_PORT and TEST_WEB_PORT. It deliberately has no
// defaults: if it is started any other way it refuses, so it can never fall back to an unsafe setup.
// Nothing here changes client/vite.config.ts (which still proxies to 4000 for normal development).

const need = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Start this stack with run-suite.mjs (npm run test:stack), not directly.`)
  return value
}

const REPO = need('TEST_REPO')
const API_PORT = Number(need('TEST_API_PORT'))
const WEB_PORT = Number(need('TEST_WEB_PORT'))

if (API_PORT === 4000 || WEB_PORT === 4000) throw new Error('Refusing to use port 4000: that is the development server.')

export default {
  root: `${REPO}/client`,
  preview: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['x-test-stack'] = '1'
          })
        },
      },
    },
  },
}

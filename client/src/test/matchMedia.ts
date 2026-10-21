import { vi } from 'vitest'

type Listener = (event: MediaQueryListEvent) => void

/**
 * jsdom has no matchMedia. This installs a controllable one:
 * `matches` decides the initial answer for every query, and `change()` simulates the OS or window changing.
 */
export function installMatchMedia(matches = false) {
  let current = matches
  const listeners = new Set<Listener>()

  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList =>
      ({
        media: query,
        get matches() {
          return current
        },
        addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
        removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      }) as unknown as MediaQueryList,
  )

  return {
    change(next: boolean) {
      current = next
      for (const listener of [...listeners]) listener({ matches: next } as MediaQueryListEvent)
    },
  }
}

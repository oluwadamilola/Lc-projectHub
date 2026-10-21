import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { THEME_STORAGE_KEY, ThemeContext, type Theme } from './useTheme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * The saved choice wins. On a first visit (nothing saved) the operating-system preference picks
 * the starting theme, once; after that only the user's own choice changes it. An old saved value
 * such as "system" from an earlier version is ignored.
 */
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage can be blocked (private mode, policy); fall through to the system preference.
  }
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Ignore: the choice still applies for this session.
    }
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

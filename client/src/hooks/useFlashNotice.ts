import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * A one-off confirmation passed along by the page that just did something (for example "Project PRJ-113 was deleted.").
 * It is read once and then cleared from the history entry, so a refresh or Back does not show it again.
 */
export function useFlashNotice(): string | undefined {
  const location = useLocation()
  const navigate = useNavigate()
  const [text] = useState(() => (location.state as { notice?: string } | null)?.notice || undefined)
  const clearedRef = useRef(false)
  useEffect(() => {
    if (text && !clearedRef.current) {
      clearedRef.current = true
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }
  }, [text, navigate, location.pathname, location.search])
  return text
}

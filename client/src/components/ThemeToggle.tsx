import { useRef, type KeyboardEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { useTheme, type Theme } from '../theme/useTheme'

const options: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light theme', icon: 'sun' },
  { value: 'dark', label: 'Dark theme', icon: 'moon' },
]

/** A radio group: arrow keys move between options, Tab leaves the group. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    setTheme(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            refs.current[index] = element
          }}
          type="button"
          role="radio"
          className="theme-toggle__option"
          aria-checked={theme === option.value}
          aria-label={option.label}
          title={option.label}
          tabIndex={theme === option.value ? 0 : -1}
          onClick={() => setTheme(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <Icon name={option.icon} />
        </button>
      ))}
    </div>
  )
}

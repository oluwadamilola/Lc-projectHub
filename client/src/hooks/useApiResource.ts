import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '../api/http'

export type ResourceState<T> =
  | { status: 'loading'; data: T | undefined }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiRequestError; data: T | undefined }

type Outcome<T> = { ok: true; data: T } | { ok: false; error: ApiRequestError }

interface Settled<T> {
  /** Which request this outcome belongs to. */
  key: string
  attempt: number
  outcome: Outcome<T>
  /** Most recent successful data, kept so the screen does not flash empty while reloading. */
  lastData: T | undefined
}

/**
 * Loads data whenever `deps` change and reports loading / success / error.
 *
 * `deps` must be JSON-serialisable values (strings, numbers, booleans): they identify the request.
 * "Loading" is derived during render (no result yet for the current request), so no state is set
 * synchronously inside an effect. In-flight requests are cancelled when the request changes or
 * the component unmounts.
 */
export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): ResourceState<T> & { reload: () => void } {
  const key = JSON.stringify(deps)
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const reload = useCallback(() => setAttempt((count) => count + 1), [])

  // Always call the latest `load` without making it a trigger for refetching.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ key, attempt, outcome: { ok: true, data }, lastData: data })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure =
          error instanceof ApiRequestError ? error : new ApiRequestError('Something went wrong. Please try again.', 0)
        setSettled((previous) => ({
          key,
          attempt,
          outcome: { ok: false, error: failure },
          lastData: previous?.lastData,
        }))
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const current = settled && settled.key === key && settled.attempt === attempt ? settled : null
  const reloadFn = { reload }
  if (!current) return { status: 'loading', data: settled?.lastData, ...reloadFn }
  if (current.outcome.ok) return { status: 'success', data: current.outcome.data, ...reloadFn }
  return { status: 'error', error: current.outcome.error, data: current.lastData, ...reloadFn }
}

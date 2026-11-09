import { useCallback, useEffect, useRef, useState } from 'react'
import type { InspectionView } from '@lc-projecthub/shared'
import { validateResultDraftInput } from '@lc-projecthub/shared'
import { saveInspectionResult } from '../api/audit'
import { ApiRequestError } from '../api/http'
import type { LineDraft } from '../lib/inspection'

export type SaveState = 'saving' | 'saved' | 'error'
export interface LineSave {
  state: SaveState
  message?: string
}

/** How long typing must pause before a note is sent. Choosing a condition is sent at once. */
export const NOTE_SAVE_DELAY_MS = 700

interface Options {
  inspectionId: string
  /** Called with the inspection the server returns after each saved line (progress, what is still missing). */
  onSaved: (view: InspectionView) => void
}

/**
 * Saves each line of the checklist as it is answered. Changes are sent one at a time, in the order they were made,
 * so the answer from the server always describes the latest state. What the inspector typed stays the source of
 * truth on screen: a response never overwrites it. A failed save is kept (and shown) until it is retried or the
 * line is changed again.
 */
export function useChecklistAutosave({ inspectionId, onSaved }: Options) {
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [saves, setSaves] = useState<Record<string, LineSave>>({})

  const draftsRef = useRef<Record<string, LineDraft>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const queue = useRef<string[]>([])
  const running = useRef<Promise<void> | null>(null)
  const failed = useRef(new Set<string>())
  const onSavedRef = useRef(onSaved)
  const idRef = useRef(inspectionId)
  useEffect(() => {
    onSavedRef.current = onSaved
    idRef.current = inspectionId
  })

  const mark = useCallback((itemId: string, save: LineSave | null) => {
    setSaves((previous) => {
      const next = { ...previous }
      if (save) next[itemId] = save
      else delete next[itemId]
      return next
    })
  }, [])

  const run = useCallback((): Promise<void> => {
    if (running.current) return running.current
    const loop = async () => {
      while (queue.current.length > 0) {
        const itemId = queue.current.shift()!
        const draft = draftsRef.current[itemId]
        if (!draft) continue
        const checked = validateResultDraftInput(draft)
        if (!checked.ok) {
          failed.current.add(itemId)
          mark(itemId, { state: 'error', message: checked.errors.map((problem) => problem.message).join(' ') })
          continue
        }
        mark(itemId, { state: 'saving' })
        try {
          const response = await saveInspectionResult(idRef.current, itemId, checked.value)
          failed.current.delete(itemId)
          onSavedRef.current(response.data)
          // Saved only if nothing newer is waiting for this line.
          if (!queue.current.includes(itemId) && !timers.current.has(itemId)) mark(itemId, { state: 'saved' })
        } catch (error) {
          failed.current.add(itemId)
          const message = error instanceof ApiRequestError ? error.message : 'Something went wrong. Please try again.'
          mark(itemId, { state: 'error', message })
        }
      }
    }
    const promise = loop().finally(() => {
      running.current = null
    })
    running.current = promise
    return promise
  }, [mark])

  const enqueue = useCallback(
    (itemId: string) => {
      const timer = timers.current.get(itemId)
      if (timer) clearTimeout(timer)
      timers.current.delete(itemId)
      if (!queue.current.includes(itemId)) queue.current.push(itemId)
      failed.current.delete(itemId)
      void run()
    },
    [run],
  )

  /** Records a change to one line. A condition is saved straight away; typed text waits for a pause. */
  const change = useCallback(
    (itemId: string, base: LineDraft, patch: Partial<LineDraft>, options: { immediate: boolean }) => {
      const next = { ...(draftsRef.current[itemId] ?? base), ...patch }
      draftsRef.current = { ...draftsRef.current, [itemId]: next }
      setDrafts(draftsRef.current)
      if (options.immediate) {
        enqueue(itemId)
        return
      }
      const previous = timers.current.get(itemId)
      if (previous) clearTimeout(previous)
      failed.current.delete(itemId)
      mark(itemId, { state: 'saving' })
      timers.current.set(itemId, setTimeout(() => enqueue(itemId), NOTE_SAVE_DELAY_MS))
    },
    [enqueue, mark],
  )

  /** Sends everything waiting and resolves with true when every line is saved (false if any failed). */
  const settle = useCallback(async (): Promise<boolean> => {
    for (const itemId of [...timers.current.keys()]) enqueue(itemId)
    await run()
    return failed.current.size === 0
  }, [enqueue, run])

  /** Tries again every line whose save failed. */
  const retry = useCallback(() => {
    for (const itemId of [...failed.current]) enqueue(itemId)
  }, [enqueue])

  // Leaving the page sends whatever is still waiting, rather than losing it.
  useEffect(() => {
    const pending = timers.current
    const waiting = queue.current
    return () => {
      for (const [itemId, timer] of pending) {
        clearTimeout(timer)
        if (!waiting.includes(itemId)) waiting.push(itemId)
      }
      pending.clear()
      void run()
    }
  }, [run])

  const values = Object.values(saves)
  const status: 'idle' | 'saving' | 'saved' | 'error' = values.some((save) => save.state === 'error')
    ? 'error'
    : values.some((save) => save.state === 'saving')
      ? 'saving'
      : values.length > 0
        ? 'saved'
        : 'idle'

  return { drafts, saves, status, change, settle, retry }
}

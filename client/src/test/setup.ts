import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { installMatchMedia } from './matchMedia'

beforeEach(() => {
  // Default: a light, narrow screen. Tests that care install their own.
  installMatchMedia(false)
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

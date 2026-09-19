import { expect, it } from 'vitest'
import { formatTimestamp, parseEditedTimestamp } from './time'

it('preserves microseconds on untouched inspector fields while parsing intentional edits', () => {
  const original = 18_000_013
  expect(parseEditedTimestamp(formatTimestamp(original, ':'), original)).toBe(original)
  expect(parseEditedTimestamp('00:00:19:123', original)).toBe(19_123_000)
  expect(parseEditedTimestamp('invalid', original)).toBeNull()
})

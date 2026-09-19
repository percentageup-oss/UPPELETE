import { describe, expect, it } from 'vitest'
import { parseSrt, serializeSrt } from './srt'

describe('SRT', () => {
  it('preserves BOM/CRLF mixed-script text, multiline cues, and timing', () => {
    const source = '\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nഇത് React tutorial ആണ്\r\nരണ്ടാം വരി\r\n'
    const result = parseSrt(source)
    expect(result.issues).toEqual([])
    expect(result.cues[0]).toMatchObject({ startUs: 1_250_000, endUs: 3_500_000, text: 'ഇത് React tutorial ആണ്\nരണ്ടാം വരി' })
    expect(serializeSrt(result.cues)).toContain('00:00:01,250 --> 00:00:03,500\nഇത് React tutorial ആണ്\nരണ്ടാം വരി')
  })

  it('reports malformed and negative-duration blocks without changing valid cues', () => {
    const result = parseSrt('1\nno timing\n\n2\n00:00:04,000 --> 00:00:03,000\nbad\n\n3\n00:00:05,000 --> 00:00:06,000\ngood')
    expect(result.issues).toHaveLength(2)
    expect(result.cues).toHaveLength(1)
    expect(result.cues[0].text).toBe('good')
  })
})

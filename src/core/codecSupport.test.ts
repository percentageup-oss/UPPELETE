import { describe, expect, it } from 'vitest'
import { containerPlaybackHint, describeMediaError, describePlayFailure } from './codecSupport'

describe('container playback hint', () => {
  it('queries the real embedded player for a known container extension', () => {
    const canPlayType = (type: string) => type === 'video/mp4' ? 'probably' : ''
    expect(containerPlaybackHint('clip.mp4', canPlayType)).toEqual({ checked: true, verdict: 'probably' })
    expect(containerPlaybackHint('clip.MP4', canPlayType)).toEqual({ checked: true, verdict: 'probably' })
    expect(containerPlaybackHint('clip.webm', canPlayType)).toEqual({ checked: true, verdict: '' })
  })

  it('leaves unrecognized extensions unchecked rather than guessing', () => {
    expect(containerPlaybackHint('clip.mkv', () => 'maybe')).toEqual({ checked: true, verdict: 'maybe' })
    expect(containerPlaybackHint('clip', () => 'probably')).toEqual({ checked: false, verdict: '' })
    expect(containerPlaybackHint('clip.avi', () => 'probably')).toEqual({ checked: false, verdict: '' })
  })
})

describe('media error diagnostics', () => {
  it('maps the standard HTMLMediaElement error codes to actionable text', () => {
    expect(describeMediaError(null)).toBeNull()
    expect(describeMediaError({ code: 3 })).toContain('could not decode')
    expect(describeMediaError({ code: 4 })).toContain('does not support')
    expect(describeMediaError({ code: 1 })).toContain('aborted')
    expect(describeMediaError({ code: 2 })).toContain('network')
  })
})

describe('play() failure diagnostics', () => {
  const domException = (name: string, message: string) => Object.assign(new Error(message), { name })

  it('treats a superseded play (AbortError) as nothing to report', () => {
    expect(describePlayFailure(domException('AbortError', 'The play() request was interrupted by a call to pause().'), null)).toBeNull()
    expect(describePlayFailure(domException('AbortError', 'interrupted'), { code: 2 })).toBeNull()
  })

  it('names the actual DOMException so the cause is visible', () => {
    const text = describePlayFailure(domException('NotSupportedError', 'The element has no supported sources.'), null)
    expect(text).toBe('Playback could not start (NotSupportedError: The element has no supported sources.).')
  })

  it('appends the element’s own MediaError when it has one', () => {
    const text = describePlayFailure(domException('NotSupportedError', 'no sources'), { code: 2 })
    expect(text).toContain('NotSupportedError: no sources')
    expect(text).toContain('A network error interrupted loading this media.')
  })

  it('still produces a message for a non-Error rejection', () => {
    expect(describePlayFailure('boom', null)).toBe('Playback could not start (Unknown error).')
  })
})

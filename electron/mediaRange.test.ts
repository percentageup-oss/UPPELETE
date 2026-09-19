import { describe, expect, it } from 'vitest'
import { mediaContentType, planMediaRange } from './mediaRange'

describe('media byte-range planning', () => {
  it('serves the whole file with Accept-Ranges when no range is requested', () => {
    expect(planMediaRange(null, 1000, '/a/clip.mp4')).toEqual({ status: 200, start: 0, end: 999, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': '1000' } })
  })

  it('answers bounded, open-ended and suffix ranges with 206 and Content-Range', () => {
    expect(planMediaRange('bytes=100-199', 1000, '/a/clip.webm')).toMatchObject({ status: 206, start: 100, end: 199, headers: { 'Content-Length': '100', 'Content-Range': 'bytes 100-199/1000', 'Content-Type': 'video/webm' } })
    expect(planMediaRange('bytes=900-', 1000, '/a/clip.mov')).toMatchObject({ status: 206, start: 900, end: 999, headers: { 'Content-Range': 'bytes 900-999/1000' } })
    expect(planMediaRange('bytes=0-5000', 1000, '/a/clip.mkv')).toMatchObject({ status: 206, start: 0, end: 999, headers: { 'Content-Length': '1000' } })
    expect(planMediaRange('bytes=-100', 1000, '/a/clip.m4v')).toMatchObject({ status: 206, start: 900, end: 999 })
  })

  it('rejects malformed or unsatisfiable ranges with 416', () => {
    for (const header of ['bytes=1000-', 'bytes=200-100', 'bytes=-', 'bytes=-0', 'items=0-1', 'bytes=0-1,5-9']) {
      expect(planMediaRange(header, 1000, '/a/clip.mp4')).toEqual({ status: 416, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes */1000' } })
    }
  })

  it('falls back to a generic content type for unknown extensions', () => {
    expect(mediaContentType('/a/clip.MP4')).toBe('video/mp4')
    expect(mediaContentType('/a/clip.bin')).toBe('application/octet-stream')
  })
})

import { describe, expect, it } from 'vitest'
import { diagnosticSummary } from './exportDiagnostic'

describe('diagnosticSummary', () => {
  it('names the encoder that failed to open rather than the AAC teardown that follows it', () => {
    const stderr = [
      '[h264_mf @ 000001b028dc0000] format negotiation failed (1/0)',
      '[vost#0:0/h264_mf @ 000001b02a8f1a80] [enc:h264_mf @ 000001b028dae200] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
      '[fc#0 @ 000001b028d09640] Error sending frames to consumers: Generic error in an external library',
      '[fc#0 @ 000001b028d09640] Terminating thread with return code -542398533 (Generic error in an external library)',
      '[aost#0:1/aac @ 000001b028dc0740] [enc:aac @ 000001b028dac7c0] Could not open encoder before EOF',
      '[aost#0:1/aac @ 000001b028dc0740] Terminating thread with return code -22 (Invalid argument)',
      '[out#0/mp4 @ 000001b02a8c9a00] Nothing was written into output file, because at least one of its streams received no packets.',
    ].join('\r\n')
    const summary = diagnosticSummary(stderr)
    expect(summary).toMatch(/^\[h264_mf .*format negotiation failed .*Error while opening encoder/)
    expect(summary).not.toContain('aac')
  })
  it('falls back to the tail when every line is teardown, and handles an empty diagnostic', () => {
    expect(diagnosticSummary('a Task finished with error code: -22\nb Terminating thread with return code -22')).toBe('a Task finished with error code: -22 b Terminating thread with return code -22')
    expect(diagnosticSummary(undefined)).toBe('')
    expect(diagnosticSummary('only line')).toBe('only line')
  })
})

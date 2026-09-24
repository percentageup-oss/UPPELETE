/**
 * FFmpeg's threaded teardown prints its root cause first and then several generic lines per stream
 * (e.g. a video encoder that failed to open ends with `[aost#0:1/aac] Terminating thread …` and
 * `Nothing was written into output file`). Those tail lines are true of every failure, so the
 * notice shows the first lines that are not teardown noise, falling back to the tail.
 */
const TEARDOWN = /Terminating thread with return code|Task finished with error code|Could not open encoder before EOF|Error sending frames to consumers|Nothing was written into output file/

export function diagnosticSummary(diagnostic: string | undefined, maxLength = 300): string {
  const lines = diagnostic?.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? []
  const cause = lines.filter((line) => !TEARDOWN.test(line))
  return (cause.length ? cause.slice(0, 2) : lines.slice(-2)).join(' ').slice(0, maxLength)
}

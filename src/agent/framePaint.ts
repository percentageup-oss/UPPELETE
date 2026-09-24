const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Resolves once the preview under `frame` has painted the frame at the playhead the caller just
 * sought to: the sequence clock reads `targetUs`, every `<video>` inside is done seeking with a
 * decoded frame, and two animation frames have run so React's re-render and the graded-video canvas
 * have committed. Gives up after `timeoutMs` and reports `false` rather than capturing a stale frame
 * silently — the caller turns that into an honest tool error.
 */
export async function waitForFramePaint(frame: HTMLElement, clockUs: () => number, targetUs: number, timeoutMs = 4000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  const ready = () => clockUs() === targetUs && [...frame.querySelectorAll('video')].every((video) => !video.seeking && video.readyState >= 2)
  while (!ready()) {
    if (performance.now() > deadline) return false
    await sleep(30)
  }
  await nextFrame()
  await nextFrame()
  await sleep(60)
  return ready()
}

import { describe, expect, it } from 'vitest'
import { ownedProcess, PngReader } from './exportProcesses'

// A child that writes its failure to stderr and exits 1 while a grandchild it started keeps
// inherited copies of its stdout/stderr open — what Electron's helper processes do on Windows.
const EXITS_WITH_HELPER_HOLDING_PIPES = `
  const { spawn } = require('node:child_process')
  const helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true })
  helper.unref()
  process.stderr.write('export host: frame 1 failed: boom\\n')
  process.exit(1)
`

describe('ownedProcess', () => {
  it('settles soon after the process exits even while a helper still holds its pipes', async () => {
    const started = Date.now()
    const owned = ownedProcess(process.execPath, ['-e', EXITS_WITH_HELPER_HOLDING_PIPES], new AbortController().signal)
    const reader = new PngReader(owned.child.stdout)
    const [closed, frame] = await Promise.allSettled([owned.closed, reader.frame()])
    expect(Date.now() - started).toBeLessThan(5000)
    expect(closed.status).toBe('rejected')
    expect((closed as PromiseRejectedResult).reason.detail).toMatchObject({ code: 'TOOL_FAILED', exitCode: 1 })
    expect((closed as PromiseRejectedResult).reason.detail.diagnostic).toContain('frame 1 failed: boom')
    // The frame read ends too instead of waiting for the stall deadline.
    expect(frame.status).toBe('rejected')
  })

  it('still resolves a clean exit', async () => {
    const owned = ownedProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], new AbortController().signal)
    await expect(owned.closed).resolves.toBeUndefined()
  })
})

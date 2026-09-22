import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLogLine, logLine } from './exportLog'

let root: string
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'caption-export-log-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('export log', () => {
  it('creates its directory and appends one JSON line per event', async () => {
    const file = path.join(root, 'logs', 'export.log')
    await appendLogLine(file, logLine('start', { requestId: 'r1', manifestVersion: 3 }))
    await appendLogLine(file, logLine('outcome', { requestId: 'r1', state: 'failed' }))
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines).toMatchObject([{ event: 'start', requestId: 'r1', manifestVersion: 3 }, { event: 'outcome', state: 'failed' }])
    expect(typeof lines[0].at).toBe('string')
  })

  it('rotates once when the file would pass its ceiling, keeping the previous log', async () => {
    const file = path.join(root, 'export.log')
    await writeFile(file, 'x'.repeat(100))
    await appendLogLine(file, logLine('start', {}), 120)
    expect(await readdir(root)).toEqual(expect.arrayContaining(['export.log', 'export.log.1']))
    expect(await readFile(`${file}.1`, 'utf8')).toBe('x'.repeat(100))
    expect(JSON.parse((await readFile(file, 'utf8')).trim())).toMatchObject({ event: 'start' })
  })

  it('never throws on an unserializable detail', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(JSON.parse(logLine('outcome', circular))).toMatchObject({ event: 'outcome', detail: 'unserializable' })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, link, lstat, rename, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ModelManager } from './modelManager'
import { MODEL_CATALOG, modelIdSchema, type ModelArtifact, type ModelState } from '../src/core/modelCatalog'

const bytes = Buffer.from('Local network-boundary fixture: മലയാളം / English, not model weights.')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const catalog: ModelArtifact[] = MODEL_CATALOG.slice(0, 2).map((model) => ({ ...model, sizeBytes: bytes.length, sha256, url: `https://fixture.invalid/${model.fileName}` }))
const id = catalog[0].id
const response = (body: Uint8Array = bytes, status = 200, headers: Record<string, string> = {}) => new Response(new Uint8Array(body), { status, headers })
let directory: string
let root: string
const managers: ModelManager[] = []
function manager(request = vi.fn<typeof fetch>().mockImplementation(async () => response()), io: ConstructorParameters<typeof ModelManager>[2] = {}) {
  const instance = new ModelManager(root, catalog, { ...io, fetch: request })
  managers.push(instance)
  return { instance, request }
}
async function exists(filePath: string) { try { await lstat(filePath); return true } catch { return false } }
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'caption-model-fixture-')); root = path.join(directory, 'managed models മലയാളം') })
afterEach(async () => { await Promise.all(managers.splice(0).map((instance) => instance.close())); await rm(directory, { recursive: true, force: true }) })

describe('trusted catalog and honest local states', () => {
  it('allowlists exact publisher files, SHA-256/byte pins and device prerequisites', () => {
    expect(MODEL_CATALOG).toHaveLength(5)
    expect(new Set(MODEL_CATALOG.map((m) => m.fileName)).size).toBe(5)
    for (const m of MODEL_CATALOG) {
      expect(m.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(m.url).toMatch(/\/resolve\/[a-f0-9]{40}\//)
      expect(m.deviceModes[0]).toContain('CPU')
      expect(m.format).toBe('GGML F16')
    }
    expect(MODEL_CATALOG[1].languageCapability).toContain('English only')
    expect(() => modelIdSchema.parse('../../outside')).toThrow()
  })
  it('never networks or creates directories on list; rejects unknown IDs', async () => {
    const { instance, request } = manager()
    expect((await instance.list()).states.every((state) => state.status === 'absent' && !state.installed)).toBe(true)
    expect(await exists(root)).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(() => instance.download('../outside' as typeof id)).toThrow()
  })
  it('reports only real transitions and activates atomically after matching checksum', async () => {
    const { instance } = manager()
    const transitions: ModelState[] = []
    instance.subscribe((state) => transitions.push(state))
    instance.subscribe(() => { throw new Error('broken observer') })
    const result = await instance.download(id)
    expect(result.status).toBe('installed'); expect(result.installed).toBe(true)
    expect(transitions.map((state) => state.status).filter((status, index, values) => status !== values[index - 1])).toEqual(['checking', 'absent', 'downloading', 'verifying', 'installed'])
    expect(transitions.filter((state) => state.status !== 'installed').every((state) => !state.installed)).toBe(true)
    expect(await readFile(result.location)).toEqual(bytes)
    expect(await exists(result.partialLocation)).toBe(false)
  })
  it('reopens, re-verifies and resolves installed bytes offline; notices same-size corruption', async () => {
    const { instance } = manager()
    const result = await instance.download(id)
    const { instance: offline, request } = manager(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
    expect((await offline.list()).states[0].installed).toBe(true)
    expect(await offline.installedPath(id)).toBe(result.location)
    expect((await offline.download(id)).installed).toBe(true)
    expect(request).not.toHaveBeenCalled()
    await writeFile(result.location, Buffer.alloc(bytes.length))
    expect((await offline.list()).states[0]).toMatchObject({ status: 'failed', installed: false, error: { code: 'CHECKSUM' } })
    await expect(offline.installedPath(id)).rejects.toThrow()
    expect(await readFile(result.location)).toEqual(Buffer.alloc(bytes.length))
  })
  it('rejects a wrong checksum, removes untrusted partial and allows a clean retry', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(Buffer.alloc(bytes.length))).mockResolvedValueOnce(response())
    const { instance } = manager(request)
    const failed = await instance.download(id)
    expect(failed).toMatchObject({ status: 'failed', installed: false, downloadedBytes: 0, error: { code: 'CHECKSUM' } })
    expect(await exists(failed.location)).toBe(false)
    expect(await exists(failed.partialLocation)).toBe(false)
    expect((await instance.download(id)).installed).toBe(true)
  })
})

describe('interruption, cancellation and range recovery', () => {
  it('resumes persisted bytes with an exact Range after a simulated process interruption', async () => {
    const { instance } = manager()
    await mkdir(root, { recursive: true })
    await writeFile(instance.snapshot(id).partialLocation, bytes.subarray(0, 17))
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(bytes.subarray(17), 206, { 'content-range': `bytes 17-${bytes.length - 1}/${bytes.length}`, 'content-length': String(bytes.length - 17) }))
    const { instance: reopened } = manager(request)
    expect((await reopened.list()).states[0]).toMatchObject({ status: 'interrupted', installed: false, downloadedBytes: 17 })
    expect(request).not.toHaveBeenCalled()
    expect((await reopened.download(id)).installed).toBe(true)
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ Range: 'bytes=17-' })
  })
  it('verifies a full interrupted partial without accessing the network', async () => {
    const { instance, request } = manager()
    await mkdir(root, { recursive: true })
    await writeFile(instance.snapshot(id).partialLocation, bytes)
    expect((await instance.download(id)).installed).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
  it('restarts safely when the source ignores Range, including length-less responses', async () => {
    const { instance, request } = manager()
    await mkdir(root, { recursive: true }); await writeFile(instance.snapshot(id).partialLocation, bytes.subarray(0, 9))
    expect((await instance.download(id)).installed).toBe(true)
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ Range: 'bytes=9-' })
    expect(await readFile(instance.snapshot(id).location)).toEqual(bytes)
  })
  it.each([
    [206, { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` }],
    [206, { 'content-range': `bytes 9-${bytes.length - 1}/${bytes.length + 1}` }],
    [206, {}],
    [200, { 'content-length': String(bytes.length + 1) }],
    [200, { 'content-encoding': 'gzip' }],
  ])('retains saved bytes on invalid response %s %j', async (status, headers) => {
    const { instance } = manager(vi.fn<typeof fetch>().mockResolvedValue(response(bytes, status as number, headers as Record<string, string>)))
    await mkdir(root, { recursive: true }); await writeFile(instance.snapshot(id).partialLocation, bytes.subarray(0, 9))
    const result = await instance.download(id)
    expect(result.error?.code).toBe('INVALID_SOURCE'); expect(result.installed).toBe(false)
    expect(await readFile(result.partialLocation)).toEqual(bytes.subarray(0, 9))
  })
  it('keeps actual bytes from a short body; reopened state is interrupted', async () => {
    const { instance } = manager(vi.fn<typeof fetch>().mockResolvedValue(response(bytes.subarray(0, 13))))
    const result = await instance.download(id)
    expect(result).toMatchObject({ status: 'failed', downloadedBytes: 13, error: { code: 'NETWORK' } })
    const { instance: reopened } = manager()
    expect((await reopened.list()).states[0]).toMatchObject({ status: 'interrupted', downloadedBytes: 13, installed: false })
  })
  it('retains successfully written bytes when the stream throws', async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (!pulls++) controller.enqueue(bytes.subarray(0, 13)); else controller.error(new Error('disconnected')) } }, { highWaterMark: 0 })
    const { instance } = manager(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)))
    const result = await instance.download(id)
    expect(result).toMatchObject({ status: 'failed', downloadedBytes: 13, installed: false, error: { code: 'NETWORK' } })
    expect(await readFile(result.partialLocation)).toEqual(bytes.subarray(0, 13))
  })
  it('cancels a blocked reader, settles only after file close, retains partial and resumes', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, 15)) } })
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(response(bytes.subarray(15), 206, { 'content-range': `bytes 15-${bytes.length - 1}/${bytes.length}` }))
    const { instance } = manager(request)
    const cancelledStates: ModelState[] = []
    const unsubscribe = instance.subscribe((state) => { cancelledStates.push(state) })
    const done = instance.download(id)
    await vi.waitFor(() => expect(instance.snapshot(id).downloadedBytes).toBe(15))
    instance.cancel(id)
    const result = await done
    expect(result).toMatchObject({ status: 'cancelled', downloadedBytes: 15, installed: false, cancelRequested: false })
    expect(await readFile(result.partialLocation)).toEqual(bytes.subarray(0, 15))
    expect(await exists(result.location)).toBe(false)
    expect(cancelledStates.some((state) => state.status === 'downloading' && state.cancelRequested)).toBe(true)
    unsubscribe()
    expect((await instance.download(id)).installed).toBe(true)
  })
  it('handles cancellation immediately after explicit action, before work starts', async () => {
    const { instance, request } = manager()
    const done = instance.download(id); instance.cancel(id)
    expect((await done).status).toBe('cancelled')
    expect(request).not.toHaveBeenCalled(); expect(await exists(root)).toBe(false)
  })
  it('cancellation during checksum verification prevents activation', async () => {
    const { instance } = manager()
    instance.subscribe((state) => { if (state.status === 'verifying' && !state.cancelRequested) instance.cancel(id) })
    expect((await instance.download(id)).status).toBe('cancelled')
    expect(await exists(instance.snapshot(id).location)).toBe(false)
    expect(await readFile(instance.snapshot(id).partialLocation)).toEqual(bytes)
  })
  it('cancellation during the last async preflight still prevents activation', async () => {
    let entered!: () => void; const enter = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
    let finalChecks = 0
    const { instance } = manager(undefined, { io: { lstat: (async (...args: Parameters<typeof lstat>) => {
      if (String(args[0]).endsWith(catalog[0].fileName) && ++finalChecks === 2) { entered(); await gate }
      return lstat(...args)
    }) as typeof lstat } })
    await mkdir(root, { recursive: true })
    const done = instance.download(id); await enter; instance.cancel(id); release()
    expect((await done)).toMatchObject({ status: 'cancelled', installed: false })
    expect(await exists(instance.snapshot(id).location)).toBe(false)
    expect(await readFile(instance.snapshot(id).partialLocation)).toEqual(bytes)
  })
  it('late cancellation cannot overtake activation already in progress', async () => {
    let entered!: () => void; const enter = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
    const { instance } = manager(undefined, { io: { rename: async (...args) => { entered(); await gate; return rename(...args) } } })
    const done = instance.download(id); await enter; instance.cancel(id); release()
    expect((await done)).toMatchObject({ status: 'installed', installed: true, cancelRequested: false })
  })
  it('serializes duplicate operations and rejects backend use while busy', async () => {
    let release!: (response: Response) => void
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const { instance } = manager(request)
    const done = instance.download(id)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect((await instance.download(id)).installed).toBe(false)
    expect((await instance.remove(id)).installed).toBe(false)
    await expect(instance.installedPath(id)).rejects.toThrow('busy')
    release(response()); expect((await done).installed).toBe(true)
  })
  it('close aborts active network work and prevents new operations', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }))
    const { instance } = manager(request)
    const done = instance.download(id)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    await instance.close(); expect((await done).status).toBe('cancelled')
    expect(() => instance.download(id)).toThrow('closed')
  })
})

describe('disk errors and safe removal', () => {
  it.each(['ENOSPC', 'EACCES'])('reports %s creating the owned directory without touching other files', async (code) => {
    const sentinel = path.join(directory, 'input-media'); await writeFile(sentinel, bytes)
    const { instance, request } = manager(undefined, { io: { mkdir: async () => { throw Object.assign(new Error(code), { code }) } } })
    expect((await instance.download(id))).toMatchObject({ status: 'failed', installed: false, error: { code: 'DISK' } })
    expect(request).not.toHaveBeenCalled(); expect(await readFile(sentinel)).toEqual(bytes)
  })
  it('reports write failure with honest saved byte count and can resume', async () => {
    let inject = true
    const { instance } = manager(undefined, { io: { open: async (...args: Parameters<typeof open>) => {
      const handle = await open(...args)
      if (String(args[0]).endsWith('.part') && inject && args[1] !== 0) {
        const write = handle.write.bind(handle)
        let calls = 0
        handle.write = (async (buffer: Uint8Array, offset: number, _length: number, position: number) => {
          if (calls++) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
          return write(buffer, offset, 7, position)
        }) as unknown as typeof handle.write
      }
      return handle
    } } })
    const result = await instance.download(id)
    expect(result).toMatchObject({ status: 'failed', installed: false, downloadedBytes: 7, error: { code: 'DISK' } })
    expect(await readFile(result.partialLocation)).toEqual(bytes.subarray(0, 7))
    inject = false
    // Default fixture source ignores Range; safely restarts and verifies.
    expect((await instance.download(id)).installed).toBe(true)
  })
  it('failed fsync never activates a model', async () => {
    const { instance } = manager(undefined, { io: { open: async (...args: Parameters<typeof open>) => {
      const handle = await open(...args)
      if (String(args[0]).endsWith('.part')) handle.sync = async () => { throw new Error('fsync failed') }
      return handle
    } } })
    expect((await instance.download(id))).toMatchObject({ status: 'failed', installed: false, error: { code: 'DISK' } })
    expect(await exists(instance.snapshot(id).location)).toBe(false)
  })
  it('atomic rename failure leaves a complete inactive partial recoverable offline', async () => {
    const { instance } = manager(undefined, { io: { rename: async () => { throw new Error('destination disk denied') } } })
    const failed = await instance.download(id)
    expect(failed).toMatchObject({ status: 'failed', installed: false, error: { code: 'DISK' } })
    expect(await exists(failed.location)).toBe(false)
    expect(await readFile(failed.partialLocation)).toEqual(bytes)
    const { instance: reopened, request } = manager()
    expect((await reopened.download(id)).installed).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
  it('deletes only the selected exact managed file and partial; preserves another model and neighbors', async () => {
    const { instance } = manager()
    const a = await instance.download(id)
    const b = await instance.download(catalog[1].id)
    await writeFile(a.partialLocation, bytes.subarray(0, 4))
    const sentinel = path.join(root, 'keep-this.bin'); await writeFile(sentinel, bytes)
    expect((await instance.remove(id)).status).toBe('absent')
    expect(await exists(a.location)).toBe(false); expect(await exists(a.partialLocation)).toBe(false)
    expect(await readFile(b.location)).toEqual(bytes); expect(await readFile(sentinel)).toEqual(bytes)
    expect((await instance.remove(id)).status).toBe('absent')
  })
  it.each(['symbolic', 'hard', 'directory'])('refuses %s links/nonregular selected paths on download and removal', async (kind) => {
    const { instance, request } = manager()
    const outside = path.join(directory, 'original-media'); await writeFile(outside, bytes)
    await mkdir(root, { recursive: true })
    const selected = instance.snapshot(id).partialLocation
    if (kind === 'symbolic') await symlink(outside, selected)
    else if (kind === 'hard') await link(outside, selected)
    else await mkdir(selected)
    expect((await instance.download(id)).error?.code).toBe('UNSAFE_PATH')
    expect((await instance.remove(id)).error?.code).toBe('UNSAFE_PATH')
    expect(request).not.toHaveBeenCalled()
    expect(await readFile(outside)).toEqual(bytes); expect(await exists(selected)).toBe(true)
  })
  it('refuses a symlinked model directory and preserves its external target', async () => {
    const { instance, request } = manager()
    const outside = path.join(directory, 'external'); await mkdir(outside)
    await writeFile(path.join(outside, catalog[0].fileName), bytes)
    await symlink(outside, root)
    expect((await instance.download(id)).error?.code).toBe('UNSAFE_PATH')
    expect((await instance.remove(id)).error?.code).toBe('UNSAFE_PATH')
    expect(await readFile(path.join(outside, catalog[0].fileName))).toEqual(bytes)
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses a symlinked managed parent before creating or removing selected files', async () => {
    const outside = path.join(directory, 'external-parent'); await mkdir(outside)
    await mkdir(path.join(outside, 'models'))
    await writeFile(path.join(outside, 'models', catalog[0].fileName), bytes)
    const redirected = path.join(directory, 'Models'); await symlink(outside, redirected)
    root = path.join(redirected, 'models')
    const { instance, request } = manager()
    expect((await instance.download(id)).error?.code).toBe('UNSAFE_PATH')
    expect((await instance.remove(id)).error?.code).toBe('UNSAFE_PATH')
    expect(await readFile(path.join(outside, 'models', catalog[0].fileName))).toEqual(bytes)
    expect(request).not.toHaveBeenCalled()
  })
  it('reports unlink errors without claiming removal succeeded', async () => {
    const { instance } = manager(undefined, { io: { unlink: async () => { throw new Error('access denied') } } })
    await instance.download(id)
    const result = await instance.remove(id)
    expect(result).toMatchObject({ status: 'failed', error: { code: 'DISK' } })
    expect(await readFile(result.location)).toEqual(bytes)
  })
})

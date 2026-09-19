import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { MODEL_CATALOG, modelIdSchema, type ManagedModelId, type ModelArtifact, type ModelState } from '../src/core/modelCatalog'

const diskIO = { mkdir: fs.mkdir, lstat: fs.lstat, open: fs.open, rename: fs.rename, unlink: fs.unlink }
type DiskIO = typeof diskIO
type ErrorCode = NonNullable<ModelState['error']>['code']
class ModelFailure extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message) }
}
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Main-owned, async streaming I/O. Renderer supplies only allowlisted IDs, never paths or URLs. */
export class ModelManager {
  private readonly states = new Map<ManagedModelId, ModelState>()
  private readonly active = new Map<ManagedModelId, { abort: AbortController; done: Promise<ModelState>; committing: boolean; cancellable: boolean }>()
  private readonly listeners = new Set<(state: ModelState) => void>()
  private readonly io: DiskIO
  private readonly request: typeof fetch
  private closed = false

  constructor(private readonly root: string, private readonly catalog: readonly ModelArtifact[] = MODEL_CATALOG, dependencies: { fetch?: typeof fetch; io?: Partial<DiskIO> } = {}) {
    if (!path.isAbsolute(root)) throw new Error('Model directory must be absolute')
    this.io = { ...diskIO, ...dependencies.io }
    this.request = dependencies.fetch ?? fetch
    for (const model of catalog) {
      modelIdSchema.parse(model.id)
      if (!/^[a-zA-Z0-9.-]+\.bin$/.test(model.fileName) || !/^[a-f0-9]{64}$/.test(model.sha256) || !Number.isSafeInteger(model.sizeBytes) || model.sizeBytes <= 0 || !model.url.startsWith('https://')) throw new Error('Invalid trusted model catalog')
      this.states.set(model.id, { id: model.id, location: path.join(root, model.fileName), partialLocation: path.join(root, `${model.fileName}.part`), status: 'absent', installed: false, partialPresent: false, downloadedBytes: 0, cancelRequested: false, error: null })
    }
  }
  subscribe(listener: (state: ModelState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot(id: ManagedModelId): ModelState { return structuredClone(this.state(id)) }
  private state(id: ManagedModelId) {
    const state = this.states.get(modelIdSchema.parse(id))
    if (!state) throw new Error('Model is not in the managed catalog')
    return state
  }
  private publish(id: ManagedModelId, patch: Partial<ModelState>) {
    Object.assign(this.state(id), patch)
    const state = this.snapshot(id)
    for (const listener of this.listeners) { try { listener(state) } catch { /* UI observers cannot corrupt file operations. */ } }
    return state
  }
  private model(id: ManagedModelId) { this.state(id); return this.catalog.find((model) => model.id === id)! }
  private async directory(create: boolean) {
    // The app-owned Models parent must not redirect selected paths outside managed storage.
    try {
      const parent = await this.io.lstat(path.dirname(this.root))
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new ModelFailure('UNSAFE_PATH', 'Managed model parent must be a real directory, not a symbolic link')
    } catch (error) { if (!isMissing(error)) throw error }
    if (create) await this.io.mkdir(this.root, { recursive: true })
    try {
      const stat = await this.io.lstat(this.root)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ModelFailure('UNSAFE_PATH', 'Managed model directory must be a real directory, not a symbolic link')
    } catch (error) { if (!create && isMissing(error)) return false; throw error }
    return true
  }
  private async file(filePath: string) {
    try {
      const stat = await this.io.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new ModelFailure('UNSAFE_PATH', `Refusing nonregular or linked managed file: ${filePath}`)
      return stat
    } catch (error) { if (isMissing(error)) return null; throw error }
  }
  private async hash(filePath: string, signal?: AbortSignal) {
    const handle = await this.io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.nlink !== 1) throw new ModelFailure('UNSAFE_PATH', 'Refusing linked model file')
      const hash = createHash('sha256')
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
        signal?.throwIfAborted()
        hash.update(chunk)
      }
      signal?.throwIfAborted()
      const after = await handle.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new ModelFailure('DISK', 'Model changed while verifying; retry verification')
      return { sha256: hash.digest('hex'), size: after.size }
    } finally { await handle.close() }
  }
  private fail(id: ManagedModelId, error: unknown) {
    const failure = error instanceof ModelFailure ? error : new ModelFailure('DISK', `Model disk operation failed: ${error instanceof Error ? error.message : String(error)}`)
    return this.publish(id, { status: 'failed', installed: false, error: { code: failure.code, message: failure.message } })
  }
  private async inspect(id: ManagedModelId, signal: AbortSignal) {
    const model = this.model(id)
    const state = this.state(id)
    this.publish(id, { status: 'checking', installed: false, error: null, cancelRequested: false })
    const hasDirectory = await this.directory(false)
    signal.throwIfAborted()
    if (!hasDirectory) return this.publish(id, { status: 'absent', partialPresent: false, downloadedBytes: 0 })
    const partial = await this.file(state.partialLocation)
    signal.throwIfAborted()
    this.publish(id, { partialPresent: partial !== null, downloadedBytes: partial?.size ?? 0 })
    const final = await this.file(state.location)
    signal.throwIfAborted()
    if (final) {
      if (final.size !== model.sizeBytes) throw new ModelFailure('CHECKSUM', 'Installed file size differs from the trusted catalog; remove it before downloading again')
      const verified = await this.hash(state.location, signal)
      signal.throwIfAborted()
      if (verified.size !== model.sizeBytes || verified.sha256 !== model.sha256) throw new ModelFailure('CHECKSUM', 'Installed file does not match the trusted SHA-256/size; remove it before downloading again')
      return this.publish(id, { status: 'installed', installed: true, downloadedBytes: model.sizeBytes })
    }
    if (partial && partial.size > model.sizeBytes) throw new ModelFailure('CHECKSUM', 'Partial file exceeds catalog size; remove it before retrying')
    return this.publish(id, { status: partial ? 'interrupted' : 'absent', downloadedBytes: partial?.size ?? 0 })
  }
  private operation(id: ManagedModelId, run: (signal: AbortSignal) => Promise<ModelState>, cancellable = true) {
    this.state(id)
    if (this.closed) throw new Error('Model manager is closed')
    if (this.active.has(id)) return Promise.resolve(this.snapshot(id))
    const abort = new AbortController()
    // Register ownership before any async observer can request another operation.
    const done = Promise.resolve().then(() => { abort.signal.throwIfAborted(); return run(abort.signal) }).catch((error: unknown) => {
      if (abort.signal.aborted && error === abort.signal.reason) return this.publish(id, { status: 'cancelled', installed: false, cancelRequested: false, error: null })
      return this.fail(id, error)
    }).finally(() => { this.active.delete(id) })
    this.active.set(id, { abort, done, committing: false, cancellable })
    return done
  }
  async list() {
    await Promise.all(this.catalog.map((model) => this.active.has(model.id) ? Promise.resolve() : this.operation(model.id, (signal) => this.inspect(model.id, signal))))
    return { catalog: this.catalog, states: this.catalog.map((model) => this.snapshot(model.id)), backendAvailable: false as const }
  }
  /** T3 must call this immediately before backend use; never trust a stored installed flag. */
  async installedPath(id: ManagedModelId) {
    if (this.active.has(id)) throw new ModelFailure('BUSY', 'Model is busy')
    const state = await this.operation(id, (signal) => this.inspect(id, signal))
    if (!state.installed) throw new Error(state.error?.message ?? 'Model is not installed')
    return state.location
  }
  download(id: ManagedModelId) { return this.operation(id, (signal) => this.transfer(id, signal)) }
  cancel(id: ManagedModelId) {
    this.state(id)
    const active = this.active.get(id)
    if (active && active.cancellable && !active.committing && !active.abort.signal.aborted) {
      active.abort.abort()
      this.publish(id, { cancelRequested: true })
    }
  }
  private async transfer(id: ManagedModelId, signal: AbortSignal) {
    const model = this.model(id)
    const state = this.state(id)
    const inspected = await this.inspect(id, signal)
    if (inspected.installed) return inspected
    signal.throwIfAborted()
    await this.directory(true)
    await this.file(state.partialLocation)
    let offset = inspected.downloadedBytes
    if (offset < model.sizeBytes) {
      this.publish(id, { status: 'downloading', error: null, cancelRequested: signal.aborted })
      let response: Response
      try {
        response = await this.request(model.url, { signal, headers: { 'Accept-Encoding': 'identity', ...(offset ? { Range: `bytes=${offset}-` } : {}) }, credentials: 'omit', referrerPolicy: 'no-referrer' })
      } catch (error) { signal.throwIfAborted(); throw new ModelFailure('NETWORK', `Download interrupted; retry to resume: ${error instanceof Error ? error.message : String(error)}`) }
      try {
        if (response.url && !response.url.startsWith('https://')) throw new ModelFailure('INVALID_SOURCE', 'Model download redirected to an insecure URL')
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new ModelFailure('INVALID_SOURCE', 'Source must send uncompressed model bytes')
        let expectedBodyBytes = model.sizeBytes
        if (response.status === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
          if (!range || Number(range[1]) !== offset || Number(range[3]) !== model.sizeBytes || Number(range[2]) < offset || Number(range[2]) >= model.sizeBytes) throw new ModelFailure('INVALID_SOURCE', 'Source returned a mismatched byte range; partial retained')
          expectedBodyBytes = Number(range[2]) - offset + 1
        } else if (response.status === 200) {
          offset = 0 // Range unsupported or representation changed: restart, never append a full response.
        } else throw new ModelFailure('NETWORK', `Source returned HTTP ${response.status}; partial retained for retry`)
        const length = response.headers.get('content-length')
        if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expectedBodyBytes)) throw new ModelFailure('INVALID_SOURCE', 'Source download length does not match the pinned model/range')
        if (!response.body) throw new ModelFailure('INVALID_SOURCE', 'Source returned no download body')
        signal.throwIfAborted()
        await this.file(state.partialLocation)
        const handle = await this.io.open(state.partialLocation, constants.O_WRONLY | constants.O_CREAT | (offset ? 0 : constants.O_TRUNC) | (constants.O_NOFOLLOW ?? 0), 0o600)
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.nlink !== 1 || stat.size !== offset) throw new ModelFailure('UNSAFE_PATH', 'Partial file changed before writing')
          this.publish(id, { downloadedBytes: offset, partialPresent: true })
          let received = 0
          const reader = response.body.getReader()
          const stopReading = () => { void reader.cancel().catch(() => {}) }
          signal.addEventListener('abort', stopReading, { once: true })
          try {
            while (true) {
              signal.throwIfAborted()
              let chunk: ReadableStreamReadResult<Uint8Array>
              try { chunk = await reader.read() } catch (error) { signal.throwIfAborted(); throw new ModelFailure('NETWORK', `Download stream interrupted; retry to resume: ${error instanceof Error ? error.message : String(error)}`) }
              signal.throwIfAborted()
              if (chunk.done) break
              if (received + chunk.value.byteLength > expectedBodyBytes || offset + chunk.value.byteLength > model.sizeBytes) throw new ModelFailure('INVALID_SOURCE', 'Source sent more bytes than the pinned model/range')
              let written = 0
              while (written < chunk.value.byteLength) {
                signal.throwIfAborted()
                const result = await handle.write(chunk.value, written, chunk.value.byteLength - written, offset)
                if (!result.bytesWritten) throw new ModelFailure('DISK', 'Disk write made no progress')
                written += result.bytesWritten
                offset += result.bytesWritten
                this.publish(id, { downloadedBytes: offset, partialPresent: true })
              }
              received += chunk.value.byteLength
            }
          } finally { signal.removeEventListener('abort', stopReading); await reader.cancel().catch(() => {}); reader.releaseLock() }
          await handle.sync()
          if (received !== expectedBodyBytes || offset !== model.sizeBytes) throw new ModelFailure('NETWORK', 'Download ended early; retry to resume saved bytes')
        } finally { await handle.close() }
      } finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}) }
    }
    signal.throwIfAborted()
    this.publish(id, { status: 'verifying' })
    const verified = await this.hash(state.partialLocation, signal)
    if (verified.sha256 !== model.sha256 || verified.size !== model.sizeBytes) {
      await this.io.unlink(state.partialLocation) // Bad bytes can never become an active model or poison resume.
      this.publish(id, { downloadedBytes: 0, partialPresent: false })
      throw new ModelFailure('CHECKSUM', 'Trusted SHA-256 verification failed; untrusted partial removed. Download again.')
    }
    signal.throwIfAborted()
    // Includes a complete partial recovered after a crash: flush before finalization.
    const durable = await this.io.open(state.partialLocation, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
    try { await durable.sync() } finally { await durable.close() }
    signal.throwIfAborted()
    await this.directory(false)
    if (await this.file(state.location)) throw new ModelFailure('DISK', 'Final model path already exists; refresh or remove it explicitly')
    signal.throwIfAborted()
    // Commit gate: cancellation after this point cannot relabel an atomic activation.
    this.active.get(id)!.committing = true
    this.publish(id, { status: 'verifying', cancelRequested: false })
    await this.io.rename(state.partialLocation, state.location)
    return this.publish(id, { status: 'installed', installed: true, partialPresent: false, downloadedBytes: model.sizeBytes, error: null })
  }
  remove(id: ManagedModelId) {
    return this.operation(id, async () => {
      const state = this.state(id)
      this.publish(id, { status: 'removing', installed: false, error: null })
      if (await this.directory(false)) {
        // Preflight BOTH selected paths; no recursive deletion, user paths, or directory cleanup.
        const final = await this.file(state.location)
        const partial = await this.file(state.partialLocation)
        if (final) await this.io.unlink(state.location)
        this.publish(id, { downloadedBytes: partial?.size ?? 0, partialPresent: partial !== null })
        if (partial) await this.io.unlink(state.partialLocation)
      }
      return this.publish(id, { status: 'absent', partialPresent: false, downloadedBytes: 0, cancelRequested: false })
    }, false)
  }
  async close() {
    this.closed = true
    for (const id of this.active.keys()) this.cancel(id)
    await Promise.all([...this.active.values()].map((active) => active.done))
  }
}

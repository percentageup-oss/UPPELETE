import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { PROJECT_FILE_EXTENSION } from '../src/core/model'

export const RECENT_PROJECTS_FILE = 'recent-projects.json'
export const MANAGED_FOLDER_NAME = 'UPPELETE Projects'
const MAX_ENTRIES = 100
export const MAX_THUMBNAIL_BYTES = 500_000

const entrySchema = z.strictObject({
  path: z.string().min(1),
  title: z.string(),
  savedAt: z.number().int().nonnegative(),
  openedAt: z.number().int().nonnegative(),
  durationUs: z.number().int().nonnegative(),
  thumbnailFile: z.string().nullable(),
})
const fileSchema = z.strictObject({ version: z.literal(1), entries: z.array(entrySchema) })

export type RecentProjectEntry = z.infer<typeof entrySchema>
/** What the home screen sees: the entry plus whether the file is still there and the thumbnail as a data URL. */
export type RecentProjectView = Omit<RecentProjectEntry, 'thumbnailFile'> & { exists: boolean; thumbnail: string | null }

const lastTouched = (entry: RecentProjectEntry) => Math.max(entry.savedAt, entry.openedAt)

/** A filesystem-safe base name; never empty. */
export function safeProjectFileName(title: string): string {
  const cleaned = title.replace(/[<>:"/\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return (cleaned || 'Untitled project').slice(0, 120)
}

/** The first free `<dir>/<title>.cstudio`, adding " (2)", " (3)" … for clashes. */
export async function uniqueProjectPath(dir: string, title: string, exists: (filePath: string) => Promise<boolean>): Promise<string> {
  const base = safeProjectFileName(title)
  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(dir, `${n === 1 ? base : `${base} (${n})`}.${PROJECT_FILE_EXTENSION}`)
    if (!(await exists(candidate))) return candidate
  }
  return path.join(dir, `${base} ${randomUUID().slice(0, 8)}.${PROJECT_FILE_EXTENSION}`)
}

export const fileExists = (filePath: string) => stat(filePath).then(() => true, () => false)

export class RecentProjectsStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly userDataPath: string) {}

  private get filePath() { return path.join(this.userDataPath, RECENT_PROJECTS_FILE) }
  get thumbnailDir() { return path.join(this.userDataPath, 'Cache', 'project-thumbnails') }

  private async read(): Promise<RecentProjectEntry[]> {
    try { return fileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8'))).entries }
    catch { return [] } // Missing or unreadable: the list is a convenience, never a source of truth.
  }

  private async write(entries: RecentProjectEntry[]) {
    await mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, entries: entries.slice(0, MAX_ENTRIES) }) + '\n', { flag: 'wx' })
    await rename(temporary, this.filePath)
  }

  /** Serialises read-modify-write so concurrent autosaves cannot lose an update. */
  private mutate<T>(change: (entries: RecentProjectEntry[]) => { entries: RecentProjectEntry[]; result: T }): Promise<T> {
    const run = async () => {
      const { entries, result } = change(await this.read())
      await this.write(entries.sort((a, b) => lastTouched(b) - lastTouched(a)))
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private thumbnailName(projectPath: string) { return `${createHash('sha1').update(projectPath).digest('hex')}.jpg` }

  /** Records a save (`kind: 'saved'`) or an open. Keeps the existing thumbnail. */
  record(projectPath: string, info: { title: string; durationUs: number }, kind: 'saved' | 'opened') {
    const now = Date.now()
    return this.mutate((entries) => {
      const existing = entries.find((entry) => entry.path === projectPath)
      const next: RecentProjectEntry = {
        path: projectPath, title: info.title, durationUs: info.durationUs,
        savedAt: kind === 'saved' ? now : existing?.savedAt ?? now,
        openedAt: kind === 'opened' ? now : existing?.openedAt ?? 0,
        thumbnailFile: existing?.thumbnailFile ?? null,
      }
      return { entries: [next, ...entries.filter((entry) => entry.path !== projectPath)], result: undefined }
    })
  }

  async has(projectPath: string): Promise<boolean> { return (await this.read()).some((entry) => entry.path === projectPath) }

  async list(): Promise<RecentProjectView[]> {
    const entries = await this.read()
    return Promise.all(entries.map(async (entry) => {
      let thumbnail: string | null = null
      if (entry.thumbnailFile) {
        try { thumbnail = `data:image/jpeg;base64,${(await readFile(path.join(this.thumbnailDir, entry.thumbnailFile))).toString('base64')}` } catch { /* cache pruned */ }
      }
      const { thumbnailFile: _file, ...rest } = entry
      return { ...rest, exists: await fileExists(entry.path), thumbnail }
    }))
  }

  async setThumbnail(projectPath: string, jpeg: Buffer): Promise<boolean> {
    if (!(await this.has(projectPath)) || jpeg.length === 0 || jpeg.length > MAX_THUMBNAIL_BYTES) return false
    const name = this.thumbnailName(projectPath)
    await mkdir(this.thumbnailDir, { recursive: true })
    const temporary = path.join(this.thumbnailDir, `${name}.${randomUUID()}.tmp`)
    await writeFile(temporary, jpeg, { flag: 'wx' })
    await rename(temporary, path.join(this.thumbnailDir, name))
    await this.mutate((entries) => ({ entries: entries.map((entry) => entry.path === projectPath ? { ...entry, thumbnailFile: name } : entry), result: undefined }))
    return true
  }

  /** Drops the entry (and its cached thumbnail). The project file itself is never touched here. */
  remove(projectPath: string) {
    return this.mutate((entries) => {
      const gone = entries.find((entry) => entry.path === projectPath)
      if (gone?.thumbnailFile) void rm(path.join(this.thumbnailDir, gone.thumbnailFile), { force: true })
      return { entries: entries.filter((entry) => entry.path !== projectPath), result: undefined }
    })
  }

  /** Moves an entry to a new path (rename), keeping its thumbnail under the new hash name. */
  async move(fromPath: string, toPath: string, title: string) {
    const entries = await this.read()
    const old = entries.find((entry) => entry.path === fromPath)
    if (!old) return
    let thumbnail: Buffer | null = null
    if (old.thumbnailFile) { try { thumbnail = await readFile(path.join(this.thumbnailDir, old.thumbnailFile)) } catch { /* pruned */ } }
    await this.remove(fromPath)
    await this.record(toPath, { title, durationUs: old.durationUs }, 'saved')
    if (thumbnail) await this.setThumbnail(toPath, thumbnail)
  }
}

import { safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'

const fileSchema = z.strictObject({ version: z.literal(1), geminiApiKey: z.string().min(1).optional() })

export class GeminiSecretStore {
  constructor(private readonly userDataPath: string) {}

  private get filePath() { return path.join(this.userDataPath, 'secrets.json') }

  async load(): Promise<string | null> {
    const override = process.env.GEMINI_API_KEY?.trim()
    if (override) return override
    try {
      const data = fileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
      if (!data.geminiApiKey) return null
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.')
      return (await safeStorage.decryptStringAsync(Buffer.from(data.geminiApiKey, 'base64'))).result
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async status() {
    return { configured: Boolean(await this.load()), source: process.env.GEMINI_API_KEY?.trim() ? 'environment' as const : 'keychain' as const }
  }

  async save(apiKey: string): Promise<void> {
    const value = apiKey.trim()
    if (value.length < 10 || value.length > 512) throw new Error('Enter a valid Gemini API key.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.')
    const encrypted = await safeStorage.encryptStringAsync(value)
    await mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, geminiApiKey: encrypted.toString('base64') }) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.filePath)
  }

  async remove(): Promise<void> {
    if (process.env.GEMINI_API_KEY?.trim()) throw new Error('Remove GEMINI_API_KEY from the environment to disable it.')
    await mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1 }) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.filePath)
  }
}

import { safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { CLOUD_PROVIDERS, cloudProvider, type CloudProviderId, type ProviderKeyStatus, type ProviderKeyStatuses } from '../src/core/transcriptionProviders'

const encrypted = z.string().min(1)
// v1 held only the Gemini key; it stays readable and is rewritten as v2 on the next change.
const fileSchema = z.union([
  z.strictObject({ version: z.literal(1), geminiApiKey: encrypted.optional() }),
  z.strictObject({ version: z.literal(2), keys: z.strictObject({ gemini: encrypted.optional(), openai: encrypted.optional(), elevenlabs: encrypted.optional() }) }),
])
type Keys = Partial<Record<CloudProviderId, string>>

export class ProviderSecretStore {
  constructor(private readonly userDataPath: string) {}

  private get filePath() { return path.join(this.userDataPath, 'secrets.json') }
  private envKey(provider: CloudProviderId) { return process.env[cloudProvider(provider).envVar]?.trim() || null }

  private async readKeys(): Promise<Keys> {
    try {
      const data = fileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
      return data.version === 1 ? (data.geminiApiKey ? { gemini: data.geminiApiKey } : {}) : data.keys
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private async writeKeys(keys: Keys): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 2, keys }) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.filePath)
  }

  async load(provider: CloudProviderId): Promise<string | null> {
    const override = this.envKey(provider)
    if (override) return override
    const stored = (await this.readKeys())[provider]
    if (!stored) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.')
    return (await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))).result
  }

  async status(provider: CloudProviderId): Promise<ProviderKeyStatus> {
    return { configured: Boolean(await this.load(provider)), source: this.envKey(provider) ? 'environment' : 'keychain' }
  }

  async statuses(): Promise<ProviderKeyStatuses> {
    const entries = await Promise.all(CLOUD_PROVIDERS.map(async (entry) => [entry.id, await this.status(entry.id)] as const))
    return Object.fromEntries(entries) as ProviderKeyStatuses
  }

  async save(provider: CloudProviderId, apiKey: string): Promise<void> {
    const value = apiKey.trim()
    if (value.length < 10 || value.length > 512) throw new Error(`Enter a valid ${cloudProvider(provider).label} API key.`)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.')
    const keys = await this.readKeys()
    keys[provider] = (await safeStorage.encryptStringAsync(value)).toString('base64')
    await this.writeKeys(keys)
  }

  async remove(provider: CloudProviderId): Promise<void> {
    if (this.envKey(provider)) throw new Error(`Remove ${cloudProvider(provider).envVar} from the environment to disable it.`)
    const keys = await this.readKeys()
    delete keys[provider]
    await this.writeKeys(keys)
  }
}

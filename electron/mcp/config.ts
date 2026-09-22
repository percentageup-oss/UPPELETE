import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

/**
 * Local agent-control settings (docs/MCP.md): whether the MCP endpoint is running, which loopback
 * port it bound and the Bearer token a client must present. Off by default. The token is a
 * loopback-only shared secret (the same trust tier as a local dev server's `.env`), not a
 * cloud credential, so it is stored plainly at 0600 rather than through OS keychain encryption —
 * that keeps port/token rotation simple and dependency-free while the file itself stays
 * unreadable to other local users.
 */
const configSchema = z.strictObject({
  version: z.literal(1),
  enabled: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).nullable().default(null),
  token: z.string().min(32).max(128).nullable().default(null),
})
export type McpConfig = z.infer<typeof configSchema>

export const MCP_CONFIG_FILE = 'mcp.json'

/** What the top-bar "Agent connected" indicator sees — never the token. */
export type McpStatus = { enabled: boolean; running: boolean; port: number | null; connections: number }
/** What the Settings "AI agents" tab sees — the token, to show and copy once. */
export type McpSettingsView = McpStatus & { token: string | null }

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export class McpConfigStore {
  constructor(private readonly userDataPath: string) {}

  private get filePath() { return path.join(this.userDataPath, MCP_CONFIG_FILE) }

  async load(): Promise<McpConfig> {
    try {
      return configSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return configSchema.parse({ version: 1 })
      throw error
    }
  }

  private async write(config: McpConfig): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(config) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.filePath)
  }

  /** Turns agent access on or off. Enabling for the first time mints a token if none exists yet;
   * the port is chosen by the caller (an OS-assigned free port) once the server actually binds. */
  async setEnabled(enabled: boolean): Promise<McpConfig> {
    const current = await this.load()
    const token = enabled ? current.token ?? newToken() : current.token
    const next = configSchema.parse({ ...current, enabled, token })
    await this.write(next)
    return next
  }

  /** Records the port the server actually bound, once it has started. */
  async setPort(port: number | null): Promise<McpConfig> {
    const current = await this.load()
    const next = configSchema.parse({ ...current, port })
    await this.write(next)
    return next
  }

  /** Invalidates every existing client's token immediately; the server must be restarted (or the
   * caller must recheck the config) for the new token to take effect. */
  async rotateToken(): Promise<McpConfig> {
    const current = await this.load()
    const next = configSchema.parse({ ...current, token: newToken() })
    await this.write(next)
    return next
  }
}

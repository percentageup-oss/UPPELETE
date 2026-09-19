import path from 'node:path'
import { app } from 'electron'
import { MediaWorkerClient } from '../workers/media/client'
import type { Toolchain } from '../workers/media/protocol'
import { LOCAL_TOOL_CONFIG_FILE, readLocalToolConfig, resolveToolchain } from './toolConfig'

let client: MediaWorkerClient | undefined
let toolchain: { value: Toolchain | undefined } | undefined

/**
 * Main-owned configuration only: CAPTION_STUDIO_* variables, then — in unpackaged runs — the gitignored
 * caption-studio.local.json at the app root. No PATH search, download or renderer executable override.
 * A configuration error is not cached, so fixing the file takes effect on the next media operation.
 */
export function configuredToolchain(): Toolchain | undefined {
  if (!toolchain) {
    const configPath = path.join(__dirname, '..', LOCAL_TOOL_CONFIG_FILE)
    const resolved = resolveToolchain(process.env, app.isPackaged ? undefined : readLocalToolConfig(configPath), configPath)
    // The export host is this same Electron runtime, pointed at the separate bundled script
    // (`scripts/export-host.mjs` -> `dist-export/host.cjs`) instead of the app's own main entry —
    // ADR 0003's separate export-host process, not a packaged production launch path (D2).
    toolchain = { value: resolved ? { ...resolved, exportHost: { executable: process.execPath, scriptPath: path.join(__dirname, '../dist-export/host.cjs') } } : resolved }
  }
  return toolchain.value
}

export function getMediaWorker(): MediaWorkerClient {
  if (!client) {
    client = new MediaWorkerClient({ workerPath: path.join(__dirname, '../dist-worker/server.cjs'), tools: configuredToolchain() })
  }
  return client
}
export function whisperCliConfigured(): boolean {
  try {
    return Boolean(configuredToolchain()?.whisperCliPath)
  } catch {
    return false
  }
}
export async function closeMediaWorker() { await client?.close() }

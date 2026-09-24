// Cross-platform `predev` hook. macOS/Linux delegate to stop-stale.sh; Windows has no reliable bash
// (`bash` there is usually the WSL launcher), so the same cleanup is done with CIM via PowerShell:
// stop processes whose command line contains this checkout's node_modules path, or that listen on
// Vite's strict port and belong to this checkout. Our own ancestors (npm, dev.ps1) are never touched.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')
const port = 5173

if (process.platform !== 'win32') {
  const result = spawnSync('bash', [resolve(scriptDir, 'stop-stale.sh')], { stdio: 'inherit' })
  process.exit(result.status ?? 0)
}

const query = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine)
$listeners = @(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess)
[pscustomobject]@{ procs = $procs; listeners = $listeners } | ConvertTo-Json -Depth 3 -Compress
`
const listing = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true })
if (listing.status !== 0 || !listing.stdout.trim()) {
  console.warn('stop-stale: could not list processes; skipping cleanup.')
  process.exit(0)
}

const { procs = [], listeners = [] } = JSON.parse(listing.stdout)
const byPid = new Map([procs].flat().map((p) => [p.ProcessId, p]))
const normalize = (text) => (text ?? '').replaceAll('/', '\\').toLowerCase()
const needle = normalize(`${root}\\node_modules\\`)
const rootNeedle = normalize(root)

const protectedPids = new Set()
for (let pid = process.pid; pid && !protectedPids.has(pid); pid = byPid.get(pid)?.ParentProcessId) protectedPids.add(pid)

const stale = new Set()
for (const p of byPid.values()) {
  if (!protectedPids.has(p.ProcessId) && normalize(p.CommandLine).includes(needle)) stale.add(p.ProcessId)
}
for (const pid of [listeners].flat().filter(Boolean)) {
  if (protectedPids.has(pid) || stale.has(pid)) continue
  const commandLine = byPid.get(pid)?.CommandLine
  if (normalize(commandLine).includes(rootNeedle)) stale.add(pid)
  else console.warn(`Port ${port} is used by another process (pid ${pid}${commandLine ? `: ${commandLine}` : ''}); not touching it.`)
}

if (stale.size === 0) process.exit(0)
console.log(`Stopping stale dev processes: ${[...stale].join(' ')}`)
for (const pid of stale) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
process.exit(0)

import { BridgeSetupError, runStdioBridge } from './mcp/stdioBridge'

// Entry for the Claude Desktop connector (docs/MCP.md). Launched by Claude Desktop as
// `<KathaCut executable> mcp-stdio.cjs <path to mcp.json>` with ELECTRON_RUN_AS_NODE=1, so it runs as
// plain Node with no window and needs no separate Node install. stdout carries protocol only; every
// human-readable message goes to stderr.
const configPath = process.argv[2]
if (!configPath) {
  process.stderr.write('Usage: mcp-stdio.cjs <path to KathaCut mcp.json>\n')
  process.exit(2)
}
runStdioBridge(configPath).catch((error) => {
  process.stderr.write(`${error instanceof BridgeSetupError ? error.message : `KathaCut connector failed: ${error instanceof Error ? error.message : String(error)}`}\n`)
  process.exit(1)
})

import { clientMessageSchema, toolchainSchema, serverMessageSchema, PROTOCOL_VERSION,
  failure, MediaWorkerError, type RequestMessage, type ServerMessage, type Toolchain } from './protocol'
import { MessageDecoder, encodeMessage } from './wire'
import { execute } from './operations'

const decoder = new MessageDecoder()
const controller = new AbortController()
let request: RequestMessage | undefined
let fatal: MediaWorkerError | undefined
let ended = false
let tools: Toolchain | undefined

function send(message: ServerMessage) {
  process.stdout.write(encodeMessage(serverMessageSchema.parse(message)))
}
function finish() {
  if (ended) return
  ended = true
  process.stdin.destroy()
  process.stdout.end()
}
function failProtocol(error: unknown) {
  if (ended || fatal) return
  fatal = error instanceof MediaWorkerError ? error : failure('INVALID_MESSAGE', 'Invalid media-worker message or configuration')
  controller.abort()
  // An active operation must reap its direct tool process before sending a terminal message.
  if (!request) { send({ version: PROTOCOL_VERSION, type: 'fatal', error: fatal.detail }); finish() }
}
async function run(job: RequestMessage) {
  const envelope = { version: PROTOCOL_VERSION, id: job.id } as const
  try {
    send({ ...envelope, type: 'progress', operation: job.task.operation, progress: { kind: 'indeterminate', phase: 'running' } })
    const result = await execute(job.task, tools, controller.signal, (progress) => {
      send({ ...envelope, type: 'progress', operation: job.task.operation, progress })
    })
    if (!controller.signal.aborted) send({ ...envelope, type: 'result', result })
  } catch (error) {
    if (!controller.signal.aborted) {
      const detail = error instanceof MediaWorkerError ? error.detail : failure('INTERNAL_ERROR', 'Media worker failed').detail
      send({ ...envelope, type: 'error', operation: job.task.operation, error: detail })
    }
  } finally {
    if (fatal) send({ version: PROTOCOL_VERSION, type: 'fatal', error: fatal.detail })
    else if (controller.signal.aborted) send({ ...envelope, type: 'cancelled', operation: job.task.operation })
    finish()
  }
}

// Broken output means the parent is gone; abort and reap any running tool.
process.stdout.on('error', () => controller.abort())
process.on('SIGTERM', () => { controller.abort(); if (!request) finish() })
process.on('SIGINT', () => { controller.abort(); if (!request) finish() })
process.stdin.on('error', failProtocol)
process.stdin.on('end', () => {
  try { decoder.finish() } catch (error) { failProtocol(error) }
  controller.abort()
  if (!request) finish()
})
try {
  const config = process.env.CAPTION_STUDIO_MEDIA_TOOLS
  if (config) tools = toolchainSchema.parse(JSON.parse(config))
} catch (error) { failProtocol(error) }
if (!ended) process.stdin.on('data', (chunk: Buffer) => {
  try {
    decoder.push(chunk, (value) => {
      if (ended || fatal) return
      const message = clientMessageSchema.parse(value)
      if (message.type === 'cancel') {
        if (!request || message.id !== request.id) throw failure('INVALID_MESSAGE', 'Cancellation does not match the active request')
        controller.abort()
      } else {
        if (request) throw failure('INVALID_MESSAGE', 'Only one request is allowed per worker process')
        request = message
        void run(message)
      }
    })
  } catch (error) { failProtocol(error) }
})

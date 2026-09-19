import { MAX_MESSAGE_BYTES, failure } from './protocol'

export function encodeMessage(value: unknown): string {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw failure('INVALID_MESSAGE', 'Worker message exceeds size limit')
  return `${text}\n`
}

// Bound bytes before JSON parsing; Buffer preserves Unicode across stream chunks.
export class MessageDecoder {
  private pending = Buffer.alloc(0)
  push(chunk: Buffer, receive: (value: unknown) => void) {
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start)
      const end = newline < 0 ? chunk.length : newline
      if (this.pending.length + end - start > MAX_MESSAGE_BYTES) throw failure('INVALID_MESSAGE', 'Worker message exceeds size limit')
      this.pending = Buffer.concat([this.pending, chunk.subarray(start, end)])
      if (newline < 0) break
      let value: unknown
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.pending)) } catch { throw failure('INVALID_MESSAGE', 'Worker message is not JSON') }
      this.pending = Buffer.alloc(0)
      receive(value)
      start = newline + 1
    }
  }
  finish() {
    if (this.pending.length) throw failure('INVALID_MESSAGE', 'Truncated worker message')
  }
}

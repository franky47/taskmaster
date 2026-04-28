type DecodeError = 'invalid-utf8' | 'oversize'

type DecodeResult =
  | { ok: true; value: string; bytes: number }
  | { ok: false; reason: DecodeError; bytes: number }

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export function decodeBoundedUtf8(buf: Buffer, maxBytes: number): DecodeResult {
  if (buf.length > maxBytes) {
    return { ok: false, reason: 'oversize', bytes: buf.length }
  }
  try {
    const value = utf8Decoder.decode(buf)
    return { ok: true, value, bytes: buf.length }
  } catch {
    return { ok: false, reason: 'invalid-utf8', bytes: buf.length }
  }
}

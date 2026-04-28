export const PREFLIGHT_STDOUT_MAX_BYTES = 1024 * 1024

type PreflightOutputErrorReason = 'invalid-utf8' | 'oversize-stdout'

type PreflightOutput =
  | { ok: true; value: string; bytes: number }
  | { ok: false; reason: PreflightOutputErrorReason; bytes: number }

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export function decodePreflightStdout(buf: Buffer): PreflightOutput {
  if (buf.length > PREFLIGHT_STDOUT_MAX_BYTES) {
    return { ok: false, reason: 'oversize-stdout', bytes: buf.length }
  }
  try {
    const value = utf8Decoder.decode(buf)
    return { ok: true, value, bytes: buf.length }
  } catch {
    return { ok: false, reason: 'invalid-utf8', bytes: buf.length }
  }
}

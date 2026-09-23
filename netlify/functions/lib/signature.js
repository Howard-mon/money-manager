import { createHmac, timingSafeEqual } from 'node:crypto'

// The raw request body must be hashed exactly as received: no JSON round-trip before this runs.
export function verifySignature(rawBody, header, secret) {
  if (typeof rawBody !== 'string' || !header || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest()
  let received
  try {
    received = Buffer.from(header, 'base64')
  } catch {
    return false
  }
  return expected.length === received.length && timingSafeEqual(expected, received)
}

/**
 * Shared Cleanverse API helpers for Next.js server-side routes.
 * Server-only — imports Node.js `crypto`, never bundle for the client.
 *
 * AES-CBC scheme (write / create endpoints):
 *   Key : Buffer.from(CLEANVERSE_API_KEY, 'base64')
 *   IV  : 16 zero bytes
 *   Body: { data: "<Base64 ciphertext>" }
 *
 * Plain JSON scheme (read / query endpoints):
 *   Body sent as-is JSON.
 */

import crypto from 'crypto'

export const CLEANVERSE_API_ID  = process.env.CLEANVERSE_API_ID
export const CLEANVERSE_API_KEY = process.env.CLEANVERSE_API_KEY
export const CLEANVERSE_API_URL =
  process.env.CLEANVERSE_API_URL ?? 'https://uatapi.cleanverse.com/api/cooperate'

export function isCleanverseConfigured(): boolean {
  return Boolean(CLEANVERSE_API_ID && CLEANVERSE_API_KEY)
}

/** AES-CBC encrypt an object and return the Base64 ciphertext. */
export function aesEncrypt(obj: unknown): string {
  if (!CLEANVERSE_API_KEY) throw new Error('CLEANVERSE_API_KEY not set')
  const key = Buffer.from(CLEANVERSE_API_KEY, 'base64')
  const iv  = Buffer.alloc(16, 0)
  const c   = crypto.createCipheriv(`aes-${key.length * 8}-cbc`, key, iv)
  return Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]).toString('base64')
}

/** Serialise an encrypted Cleanverse request body: { data: "<Base64>" }. */
export function encryptedBody(obj: unknown): string {
  return JSON.stringify({ data: aesEncrypt(obj) })
}

/** Standard Cleanverse request headers (Content-Type, api-id, X-Request-ID). */
export function cleanverseHeaders(): Record<string, string> {
  if (!CLEANVERSE_API_ID) throw new Error('CLEANVERSE_API_ID not set')
  return {
    'Content-Type': 'application/json',
    'api-id': CLEANVERSE_API_ID,
    'X-Request-ID': crypto.randomUUID(),
  }
}

/**
 * In-memory rate limiter with bounded memory.
 * When the map reaches `capacity` entries a sweep evicts all expired keys,
 * bounding growth without O(n) cost on every request.
 */
export class RateLimiter {
  private readonly map = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly capacity = 10_000,
  ) {}

  allow(key: string): boolean {
    this.pruneIfFull()
    const now   = Date.now()
    const entry = this.map.get(key)
    if (!entry || entry.resetAt < now) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    if (entry.count >= this.max) return false
    entry.count++
    return true
  }

  private pruneIfFull() {
    if (this.map.size < this.capacity) return
    const now = Date.now()
    for (const [k, v] of this.map) {
      if (v.resetAt < now) this.map.delete(k)
    }
  }
}

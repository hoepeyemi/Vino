/**
 * POST /api/cleanverse/atoken-list
 *
 * Lists CVA A-Tokens available for settlement on a given chain.
 * Calls POST /query_deposit_atoken_list (AES-CBC encrypted).
 *
 * Body:    { chain?: string }   defaults to "monad"
 * Returns: { tokens: Array<{ atoken, symbol, decimals, contractAddress, ... }> }
 *
 * Required env: CLEANVERSE_API_ID, CLEANVERSE_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  CLEANVERSE_API_URL,
  cleanverseHeaders,
  encryptedBody,
  isCleanverseConfigured,
} from '@/lib/cleanverse-server'

// Per-chain cache keyed by chain name.
const cache = new Map<string, { tokens: unknown[]; expiry: number }>()
const CACHE_TTL_MS = 10 * 60_000 // 10 minutes

export async function POST(req: NextRequest) {
  const body  = await req.json().catch(() => ({}))
  const chain: string = (body as { chain?: string }).chain ?? 'monad'

  if (!isCleanverseConfigured()) {
    return NextResponse.json({ tokens: [] })
  }

  const hit = cache.get(chain)
  if (hit && Date.now() < hit.expiry) {
    return NextResponse.json({ tokens: hit.tokens })
  }

  try {
    const raw = await fetch(`${CLEANVERSE_API_URL}/query_deposit_atoken_list`, {
      method: 'POST',
      headers: cleanverseHeaders(),
      body: encryptedBody({ chain }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!raw.ok) throw new Error(`HTTP ${raw.status}`)
    const resp = await raw.json() as { code: string; data?: unknown }

    if (resp.code === '0000' && Array.isArray(resp.data)) {
      cache.set(chain, { tokens: resp.data, expiry: Date.now() + CACHE_TTL_MS })
      return NextResponse.json({ tokens: resp.data })
    }

    // CVA not yet available on this chain — return empty list gracefully
    return NextResponse.json({ tokens: [] })
  } catch (err) {
    // External API timeout / unreachable — degrade gracefully, no crash
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    console.warn('[cleanverse/atoken-list] unavailable:', msg)
    return NextResponse.json({ tokens: [] })
  }
}

/**
 * POST /api/cleanverse/verify
 *
 * Checks whether a wallet has a valid Cleanverse A-Pass.
 * Uses POST /query_apass (A-Pass Management module, supports Monad).
 *
 * Body:   { address: string, chain?: string }
 * Returns:
 *   { verified: true,  tier: string, expirationTime: number, countries: string[] }
 *   { verified: false, reason: "not_found" | "frozen" | "expired" | "unconfigured" | "api_error" | "rate_limited" }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { RateLimiter } from '@/lib/cleanverse-server'

const API_ID  = process.env.CLEANVERSE_API_ID
const API_URL = process.env.CLEANVERSE_API_URL ?? 'https://uatapi.cleanverse.com/api/cooperate'

// Rate limit: 20 requests per IP per minute
const verifyRL = new RateLimiter(20, 60_000)

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!verifyRL.allow(ip)) {
    return NextResponse.json({ verified: false, reason: 'rate_limited' }, { status: 429 })
  }

  const body    = await req.json().catch(() => null)
  const address: string | undefined = body?.address
  const chain: string = body?.chain ?? 'monad'

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'valid address required' }, { status: 400 })
  }

  if (!API_ID) {
    return NextResponse.json({ verified: false, reason: 'unconfigured' })
  }

  try {
    const res = await fetch(`${API_URL}/query_apass`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-id': API_ID,
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify({ chain, address }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    if (data.code === '0000' && data.data && typeof data.data === 'object') {
      const apass = data.data
      const now = Math.floor(Date.now() / 1000)

      if (apass.status === 2) {
        return NextResponse.json({ verified: false, reason: 'frozen' })
      }
      if (apass.expirationTime < now) {
        return NextResponse.json({ verified: false, reason: 'expired' })
      }

      return NextResponse.json({
        verified: true,
        tier: apass.tier,
        expirationTime: apass.expirationTime,
        countries: apass.countries ?? [],
      })
    }

    return NextResponse.json({ verified: false, reason: 'not_found' })
  } catch {
    return NextResponse.json({ verified: false, reason: 'api_error' })
  }
}

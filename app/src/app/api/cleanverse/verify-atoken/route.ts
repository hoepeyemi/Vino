/**
 * POST /api/cleanverse/verify-atoken
 *
 * Cross-validates a CVA A-Token with the caller's A-Pass (POST /verify_apass).
 * Confirms a wallet is eligible to settle using a specific CVA asset.
 *
 * Body:    { address: string; atoken: string; chain?: string }
 * Returns: { verified: boolean } | { verified: false; reason: string }
 *
 * Required env: CLEANVERSE_API_ID, CLEANVERSE_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  CLEANVERSE_API_URL,
  cleanverseHeaders,
  encryptedBody,
  isCleanverseConfigured,
  RateLimiter,
} from '@/lib/cleanverse-server'

// 30 eligibility checks per address per hour
const rl = new RateLimiter(30, 3_600_000)

export async function POST(req: NextRequest) {
  const body    = await req.json().catch(() => null) as {
    address?: string; atoken?: string; chain?: string
  } | null
  const address = body?.address
  const atoken  = body?.atoken
  const chain   = body?.chain ?? 'monad'

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ verified: false, reason: 'invalid_address' }, { status: 400 })
  }
  if (!atoken) {
    return NextResponse.json({ verified: false, reason: 'missing_atoken' }, { status: 400 })
  }
  if (!isCleanverseConfigured()) {
    return NextResponse.json({ verified: false, reason: 'unconfigured' })
  }
  if (!rl.allow(address.toLowerCase())) {
    return NextResponse.json({ verified: false, reason: 'rate_limited' }, { status: 429 })
  }

  try {
    const raw = await fetch(`${CLEANVERSE_API_URL}/verify_apass`, {
      method: 'POST',
      headers: cleanverseHeaders(),
      body: encryptedBody({ chain, atoken, address }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!raw.ok) throw new Error(`HTTP ${raw.status}`)
    const resp = await raw.json() as { code: string; message?: string }

    if (resp.code === '0000') {
      return NextResponse.json({ verified: true })
    }
    return NextResponse.json({ verified: false, code: resp.code, message: resp.message })
  } catch (err) {
    console.error('[cleanverse/verify-atoken]', err)
    return NextResponse.json({ verified: false, reason: 'internal_error' }, { status: 500 })
  }
}

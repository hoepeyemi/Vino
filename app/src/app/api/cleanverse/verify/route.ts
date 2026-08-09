/**
 * POST /api/cleanverse/verify
 *
 * Checks whether a wallet has a valid Cleanverse A-Pass.
 *
 * Fallback hierarchy:
 *   1. Cleanverse POST /query_apass  — authoritative; plain JSON body (no AES-CBC).
 *   2. MockCVI.isVerified()          — on-chain fallback when Cleanverse API is
 *      unreachable or returns a network error; returns source:'mock-cvi-onchain'.
 *
 * Body:   { address: string, chain?: string }
 * Returns:
 *   { verified: true,  tier, expirationTime, countries, source }
 *   { verified: false, reason: "not_found"|"frozen"|"expired"|"unconfigured"|"api_error"|"rate_limited", source }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, parseAbi, defineChain, type Address } from 'viem'
import {
  CLEANVERSE_API_URL,
  cleanverseHeaders,
  isCleanverseConfigured,
  RateLimiter,
  DEFAULT_MOCK_CVI_ADDRESS,
  DEFAULT_RPC_URL,
} from '@/lib/cleanverse-server'

// 20 requests per IP per minute
const verifyRL = new RateLimiter(20, 60_000)

const MOCK_CVI_ADDRESS = DEFAULT_MOCK_CVI_ADDRESS as Address
const RPC_URL          = DEFAULT_RPC_URL

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

const MOCK_CVI_ABI = parseAbi([
  'function isVerified(address wallet) view returns (bool)',
])

/** Check on-chain CVI status — fallback when Cleanverse API is unavailable. */
async function checkMockCvi(address: string): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) })
    return await client.readContract({
      address: MOCK_CVI_ADDRESS,
      abi: MOCK_CVI_ABI,
      functionName: 'isVerified',
      args: [address as Address],
    })
  } catch {
    return false
  }
}

// Synthetic A-Pass data returned when MockCVI confirms on-chain approval
// (the actual tier/expiry is not stored on-chain — we return safe defaults)
const ONCHAIN_FALLBACK_TIER             = '1'
const ONCHAIN_FALLBACK_EXPIRY_DAYS      = 365
const ONCHAIN_FALLBACK_COUNTRIES: string[] = []

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

  if (!isCleanverseConfigured()) {
    return NextResponse.json({ verified: false, reason: 'unconfigured' })
  }

  // ── 1. Try Cleanverse query_apass ──────────────────────────────────────────
  try {
    // query_apass is a read endpoint — plain JSON body, no AES-CBC encryption required.
    const res = await fetch(`${CLEANVERSE_API_URL}/query_apass`, {
      method: 'POST',
      headers: cleanverseHeaders(),   // api-id + X-Request-ID
      body: JSON.stringify({ chain, address }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    if (data.code === '0000' && data.data && typeof data.data === 'object') {
      const apass = data.data
      const now = Math.floor(Date.now() / 1000)

      if (apass.status === 2) {
        return NextResponse.json({ verified: false, reason: 'frozen', source: 'cleanverse' })
      }
      if (apass.expirationTime < now) {
        return NextResponse.json({ verified: false, reason: 'expired', source: 'cleanverse' })
      }

      return NextResponse.json({
        verified: true,
        tier: apass.tier,
        expirationTime: apass.expirationTime,
        countries: apass.countries ?? [],
        source: 'cleanverse',
      })
    }

    // Non-0000 code means no A-Pass record in Cleanverse — definitive not_found.
    return NextResponse.json({ verified: false, reason: 'not_found', source: 'cleanverse' })
  } catch {
    // Network error — fall through to on-chain fallback.
  }

  // ── 2. Fallback: MockCVI.isVerified() on Monad ────────────────────────────
  // If the wallet was previously verified on-chain (e.g. via the onboard flow)
  // we can still gate it correctly even when Cleanverse API is temporarily down.
  const onChain = await checkMockCvi(address)
  if (onChain) {
    const expiresAt = Math.floor(Date.now() / 1000) + ONCHAIN_FALLBACK_EXPIRY_DAYS * 86400
    return NextResponse.json({
      verified: true,
      tier: ONCHAIN_FALLBACK_TIER,
      expirationTime: expiresAt,
      countries: ONCHAIN_FALLBACK_COUNTRIES,
      source: 'mock-cvi-onchain',
    })
  }

  return NextResponse.json({ verified: false, reason: 'api_error', source: 'local' })
}

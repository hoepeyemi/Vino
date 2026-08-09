/**
 * POST /api/cleanverse/verify-atoken
 *
 * Cross-validates a CVA A-Token with the caller's A-Pass (POST /verify_apass).
 * Confirms a wallet is eligible to settle using a specific CVA asset.
 *
 * Fallback hierarchy:
 *   1. Cleanverse /verify_apass  — authoritative when available
 *   2. MockCVI.isVerified()     — on-chain fallback for Monad testnet UAT where
 *      verify_apass may return non-0000 (endpoint not fully enabled for this chain)
 *
 * Body:    { address: string; atoken: string; chain?: string }
 * Returns: { verified: boolean; source?: string }
 *
 * Required env: CLEANVERSE_API_ID, CLEANVERSE_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, parseAbi, defineChain, type Address } from 'viem'
import {
  CLEANVERSE_API_URL,
  cleanverseHeaders,
  encryptedBody,
  isCleanverseConfigured,
  RateLimiter,
  DEFAULT_MOCK_CVI_ADDRESS,
  DEFAULT_RPC_URL,
} from '@/lib/cleanverse-server'

// 30 eligibility checks per address per hour
const rl = new RateLimiter(30, 3_600_000)

// 5-minute TTL cache — eliminates redundant Cleanverse + RPC calls on every page load.
// Key: `${address.toLowerCase()}:${atoken.toLowerCase()}`
const TTL_MS = 5 * 60 * 1_000
const eligibilityCache = new Map<string, { result: { verified: boolean; source?: string }; expiresAt: number }>()

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

/** Check on-chain CVI status as a fallback when Cleanverse API is unavailable. */
async function isMockCviVerified(address: string): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: monadTestnet,
      transport: http(RPC_URL),
    })
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
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
  if (!rl.allow(address.toLowerCase())) {
    return NextResponse.json({ verified: false, reason: 'rate_limited' }, { status: 429 })
  }

  // ── TTL cache — serve cached result when fresh ───────────────────────────────
  const cacheKey = `${address.toLowerCase()}:${atoken.toLowerCase()}`
  const cached = eligibilityCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ...cached.result, cached: true })
  }

  // ── 1. Try Cleanverse verify_apass ──────────────────────────────────────────
  if (isCleanverseConfigured()) {
    try {
      const raw = await fetch(`${CLEANVERSE_API_URL}/verify_apass`, {
        method: 'POST',
        headers: cleanverseHeaders(),
        body: encryptedBody({ chain, atoken, address }),
        signal: AbortSignal.timeout(8_000),
      })
      if (raw.ok) {
        const resp = await raw.json() as { code: string; message?: string }
        if (resp.code === '0000') {
          const result = { verified: true, source: 'cleanverse' }
          eligibilityCache.set(cacheKey, { result, expiresAt: Date.now() + TTL_MS })
          return NextResponse.json(result)
        }
        // Non-0000 may mean verify_apass is not enabled for this chain on UAT
        // — fall through to on-chain fallback rather than hard-failing.
        console.warn('[verify-atoken] verify_apass non-0000:', resp.code, resp.message)
      }
    } catch (err) {
      console.warn('[verify-atoken] verify_apass failed, trying on-chain fallback:', err)
    }
  }

  // ── 2. Fallback: check MockCVI.isVerified() on Monad ───────────────────────
  // If the wallet holds a valid on-chain A-Pass approval it is eligible for all
  // CVA A-Tokens — the CVI credential IS the settlement eligibility gate.
  const onChainVerified = await isMockCviVerified(address)
  if (onChainVerified) {
    const result = { verified: true, source: 'mock-cvi-onchain' }
    eligibilityCache.set(cacheKey, { result, expiresAt: Date.now() + TTL_MS })
    return NextResponse.json(result)
  }

  // Neither Cleanverse nor on-chain CVI verified — wallet is not eligible.
  // Do not cache negative results — let the next request retry in case the user
  // completes KYB between page loads.
  return NextResponse.json({ verified: false, reason: 'not_eligible', source: 'local' })
}

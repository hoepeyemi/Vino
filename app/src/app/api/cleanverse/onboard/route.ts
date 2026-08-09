/**
 * POST /api/cleanverse/onboard
 *
 * Self-service KYB onboarding for a wallet:
 *   1. Generates a Cleanverse A-Pass (POST /generate_apass)
 *   2. Confirms the A-Pass is active (POST /query_apass)
 *   3. Approves the wallet on-chain via MockCVI.verify()
 *
 * Body:    { address: string }
 * Returns: { success: true,  txHash: string, cvRecordId?: string, tier: string }
 *          { success: false, reason: string }
 *
 * Required env:
 *   CLEANVERSE_API_ID   — institution API ID
 *   CLEANVERSE_API_KEY  — base64-encoded AES key
 *   RELAY_PRIVATE_KEY   — deployer private key (MockCVI owner), 0x-prefixed hex
 *   MOCK_CVI_ADDRESS    — MockCVI contract address (optional, defaults to deployed address)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createWalletClient, createPublicClient, http, parseAbi, defineChain, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  CLEANVERSE_API_URL as API_URL,
  cleanverseHeaders,
  encryptedBody,
  isCleanverseConfigured,
  RateLimiter,
  DEFAULT_MOCK_CVI_ADDRESS,
  DEFAULT_RPC_URL,
} from '@/lib/cleanverse-server'

const RELAY_KEY = process.env.RELAY_PRIVATE_KEY as `0x${string}` | undefined
const MOCK_CVI_ADDRESS = DEFAULT_MOCK_CVI_ADDRESS as Address
const RPC_URL = DEFAULT_RPC_URL

const MOCK_CVI_ABI = parseAbi([
  'function isVerified(address wallet) view returns (bool)',
  'function verify(address wallet) external',
])

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

// Rate limit: 3 onboard attempts per address per hour
const onboardRL = new RateLimiter(3, 3_600_000)


export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const address: string | undefined = body?.address

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ success: false, reason: 'invalid_address' }, { status: 400 })
  }

  if (!isCleanverseConfigured()) {
    return NextResponse.json({ success: false, reason: 'unconfigured' })
  }

  if (!RELAY_KEY) {
    return NextResponse.json({ success: false, reason: 'relay_not_configured' })
  }

  if (!onboardRL.allow(address.toLowerCase())) {
    return NextResponse.json({ success: false, reason: 'rate_limited' }, { status: 429 })
  }

  try {
    const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) })

    // Short-circuit: already approved on-chain
    const alreadyVerified = await publicClient.readContract({
      address: MOCK_CVI_ADDRESS,
      abi: MOCK_CVI_ABI,
      functionName: 'isVerified',
      args: [address as Address],
    })
    if (alreadyVerified) {
      return NextResponse.json({ success: true, reason: 'already_verified' })
    }

    // customerId: "VINO" + first 20 hex chars of address (uppercase) — matches generate-apass.js
    const customerId = `VINO${address.slice(2).toUpperCase().slice(0, 20)}`
    const expirationTime = Math.floor(Date.now() / 1000) + 3 * 365 * 86400

    const genRaw = await fetch(`${API_URL}/generate_apass`, {
      method: 'POST',
      headers: cleanverseHeaders(),
      body: encryptedBody({ customerId, expirationTime, wallet: { address, chain: 'monad' } }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!genRaw.ok) throw new Error(`generate_apass HTTP ${genRaw.status}`)
    const genResp = await genRaw.json()

    let cvRecordId: string | undefined
    if (genResp.code === '0000' && genResp.data && typeof genResp.data === 'object') {
      cvRecordId = genResp.data.cvRecordId
    }
    // Non-zero code may mean A-Pass already exists — still proceed to query

    // Confirm A-Pass is active (query_apass is plain JSON — no encryption)
    const queryRaw = await fetch(`${API_URL}/query_apass`, {
      method: 'POST',
      headers: cleanverseHeaders(),
      body: JSON.stringify({ chain: 'monad', address }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!queryRaw.ok) throw new Error(`query_apass HTTP ${queryRaw.status}`)
    const queryResp = await queryRaw.json()

    if (!queryResp.data || typeof queryResp.data !== 'object') {
      return NextResponse.json({
        success: false,
        reason: 'apass_failed',
        detail: genResp.message ?? 'A-Pass could not be confirmed after generation',
      })
    }

    const apass = queryResp.data
    const now = Math.floor(Date.now() / 1000)

    if (apass.status === 2) {
      return NextResponse.json({ success: false, reason: 'frozen' })
    }
    if (apass.expirationTime < now) {
      return NextResponse.json({ success: false, reason: 'expired' })
    }

    // Relay on-chain approval
    const account = privateKeyToAccount(RELAY_KEY)
    const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) })

    const txHash = await walletClient.writeContract({
      address: MOCK_CVI_ADDRESS,
      abi: MOCK_CVI_ABI,
      functionName: 'verify',
      args: [address as Address],
    })

    return NextResponse.json({
      success: true,
      txHash,
      cvRecordId: cvRecordId ?? apass.cvRecordId,
      tier: apass.tier,
    })
  } catch (err) {
    console.error('[cleanverse/onboard]', err)
    return NextResponse.json({ success: false, reason: 'internal_error' })
  }
}

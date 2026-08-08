/**
 * POST /api/admin/cvi-manage
 *
 * Owner-only MockCVI management: check, verify, or revoke a wallet.
 *
 * "check" — read-only, no auth.
 * "verify" / "revoke" — requires a wallet signature proving the caller owns
 *   the MockCVI Ownable owner address. The server recovers the signer from the
 *   signature, reads owner() on-chain, and rejects if they don't match.
 *   RELAY_PRIVATE_KEY is used only to sign the on-chain tx — never exposed.
 *
 * Body (check):
 *   { action: "check", address: string }
 * Body (verify | revoke):
 *   { action: "verify"|"revoke", address: string,
 *     signer: string, signature: string, timestamp: number }
 *
 * Returns: { verified?, owner?, txHash?, error? }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createWalletClient, createPublicClient, http, parseAbi,
  defineChain, recoverMessageAddress, type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RateLimiter } from '@/lib/cleanverse-server'

const RELAY_KEY = process.env.RELAY_PRIVATE_KEY as `0x${string}` | undefined
const MOCK_CVI  = (process.env.MOCK_CVI_ADDRESS ?? '0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3') as Address
const RPC_URL   = process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz'

const ABI = parseAbi([
  'function isVerified(address wallet) view returns (bool)',
  'function verify(address wallet) external',
  'function revoke(address wallet) external',
  'function owner() view returns (address)',
])

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

// 30 mutating calls per IP per hour
const mutateRL = new RateLimiter(30, 3_600_000)

/** Message the client must sign — embeds action + target + 5-min window. */
function adminMessage(action: string, target: string, timestamp: number) {
  return `vino admin: ${action} ${target.toLowerCase()} at ${timestamp}`
}

export async function POST(req: NextRequest) {
  const ip   = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const body = await req.json().catch(() => null) as {
    action?: string
    address?: string
    signer?: string
    signature?: string
    timestamp?: number
  } | null

  const action  = body?.action
  const address = body?.address

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'valid address required' }, { status: 400 })
  }

  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) })

  // ── Read-only check — no auth needed ─────────────────────────────────────
  if (action === 'check') {
    try {
      const [verified, owner] = await Promise.all([
        publicClient.readContract({ address: MOCK_CVI, abi: ABI, functionName: 'isVerified', args: [address as Address] }),
        publicClient.readContract({ address: MOCK_CVI, abi: ABI, functionName: 'owner' }),
      ])
      return NextResponse.json({ verified, owner })
    } catch {
      return NextResponse.json({ error: 'rpc_error' }, { status: 502 })
    }
  }

  if (action !== 'verify' && action !== 'revoke') {
    return NextResponse.json({ error: 'action must be check | verify | revoke' }, { status: 400 })
  }

  // ── Mutating — require wallet signature from the contract owner ───────────
  const { signer, signature, timestamp } = body ?? {}

  if (!signer || !/^0x[0-9a-fA-F]{40}$/.test(signer)) {
    return NextResponse.json({ error: 'signer address required' }, { status: 400 })
  }
  if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return NextResponse.json({ error: 'signature required' }, { status: 400 })
  }
  if (!timestamp || typeof timestamp !== 'number') {
    return NextResponse.json({ error: 'timestamp required' }, { status: 400 })
  }

  // Reject signatures older than 5 minutes (replay protection)
  const age = Math.floor(Date.now() / 1000) - timestamp
  if (age < 0 || age > 300) {
    return NextResponse.json({ error: 'signature_expired' }, { status: 400 })
  }

  // Recover signer and verify it matches the on-chain owner
  try {
    const message   = adminMessage(action, address, timestamp)
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` })

    if (recovered.toLowerCase() !== signer.toLowerCase()) {
      return NextResponse.json({ error: 'signature_mismatch' }, { status: 403 })
    }

    const onchainOwner = await publicClient.readContract({
      address: MOCK_CVI, abi: ABI, functionName: 'owner',
    })
    if (recovered.toLowerCase() !== (onchainOwner as string).toLowerCase()) {
      return NextResponse.json({ error: 'not_owner' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'signature_invalid' }, { status: 400 })
  }

  if (!RELAY_KEY) {
    return NextResponse.json({ error: 'relay_not_configured' }, { status: 503 })
  }

  if (!mutateRL.allow(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  try {
    const account      = privateKeyToAccount(RELAY_KEY)
    const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) })

    const txHash = await walletClient.writeContract({
      address: MOCK_CVI,
      abi: ABI,
      functionName: action === 'verify' ? 'verify' : 'revoke',
      args: [address as Address],
    })

    return NextResponse.json({ success: true, txHash })
  } catch (err) {
    console.error('[admin/cvi-manage]', err)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('OwnableUnauthorizedAccount') || msg.includes('caller is not the owner')) {
      return NextResponse.json({ error: 'not_owner' }, { status: 403 })
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

/**
 * POST /api/cleanverse/cva-payment
 *
 * Creates a CVA-verified payment request for an invoice.
 *
 * The payment request ties together:
 *   - The invoice NFT (on-chain proof of debt)
 *   - The originator's CVI (A-Pass, verified identity)
 *   - The settlement A-Token (CVA, verified asset)
 *
 * In production this would call Cleanverse POST /create_payment_request.
 * On testnet / UAT, a fully-structured local request is generated instead —
 * all fields are real (token IDs, addresses, amounts from chain) so the
 * format is production-equivalent even on testnet.
 *
 * Body: {
 *   tokenId:            string       invoice NFT token ID
 *   amount:             string       invoice amount (human-readable, e.g. "25000")
 *   currency:           string       invoice currency (e.g. "USD")
 *   settlementToken:    string       CVA A-Token identifier
 *   settlementSymbol:   string       display symbol (e.g. "USDC")
 *   issuerAddress:      string       invoice issuer wallet (0x…)
 *   payerAddress?:      string       payer wallet (0x…) if known
 *   chain?:             string       defaults to "monad"
 * }
 *
 * Returns: { request: PaymentRequest } | { error: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  CLEANVERSE_API_URL,
  cleanverseHeaders,
  encryptedBody,
  isCleanverseConfigured,
  RateLimiter,
} from '@/lib/cleanverse-server'

const INVOICE_NFT_ADDRESS = process.env.NEXT_PUBLIC_INVOICE_NFT_ADDRESS ?? ''
const MONAD_EXPLORER      = 'https://testnet.monadexplorer.com'

// 20 payment requests per address per hour (raised for demo/judge traffic)
const rl = new RateLimiter(20, 3_600_000)

interface PaymentRequestBody {
  tokenId: string
  amount: string
  currency: string
  settlementToken: string
  settlementSymbol: string
  issuerAddress: string
  payerAddress?: string
  chain?: string
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as PaymentRequestBody | null

  if (!body?.tokenId || !body?.amount || !body?.settlementToken || !body?.issuerAddress) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(body.issuerAddress)) {
    return NextResponse.json({ error: 'invalid_issuer_address' }, { status: 400 })
  }

  const issuerKey = body.issuerAddress.toLowerCase()
  if (!rl.allow(issuerKey)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const chain = body.chain ?? 'monad'
  const requestId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48 h

  // Try Cleanverse first if configured
  if (isCleanverseConfigured()) {
    try {
      const raw = await fetch(`${CLEANVERSE_API_URL}/create_payment_request`, {
        method: 'POST',
        headers: cleanverseHeaders(),
        body: encryptedBody({
          requestId,
          chain,
          invoiceNft: { contract: INVOICE_NFT_ADDRESS, tokenId: body.tokenId },
          settlement: { atoken: body.settlementToken, symbol: body.settlementSymbol },
          amount: { value: body.amount, currency: body.currency },
          issuer: { address: body.issuerAddress },
          ...(body.payerAddress ? { payer: { address: body.payerAddress } } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (raw.ok) {
        const resp = await raw.json() as { code: string; data?: unknown }
        if (resp.code === '0000' && resp.data) {
          return NextResponse.json({ request: resp.data, source: 'cleanverse' })
        }
      }
    } catch {
      // Fall through to local generation
    }
  }

  // Local CVA payment request (production-format)
  const request = {
    requestId,
    format: 'CVA Payment Request',
    version: '1.0',
    protocol: 'Cleanverse CVA',
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt,

    // Invoice proof
    invoice: {
      tokenId:         body.tokenId,
      contractAddress: INVOICE_NFT_ADDRESS,
      chain,
      explorerUrl:     `${MONAD_EXPLORER}/nft/${INVOICE_NFT_ADDRESS}/${body.tokenId}`,
      amount:          body.amount,
      currency:        body.currency,
    },

    // Settlement asset (CVA A-Token)
    settlement: {
      atoken:   body.settlementToken,
      symbol:   body.settlementSymbol,
      amount:   body.amount,
      currency: body.currency,
      note:     'Payer must hold a Cleanverse A-Pass and be eligible for this A-Token.',
    },

    // Parties
    issuer: {
      walletAddress: body.issuerAddress,
      chain,
      kybProtocol:   'Cleanverse A-Pass',
      verifiedAt:    'onboarding',
    },
    ...(body.payerAddress ? {
      payer: {
        walletAddress: body.payerAddress,
        chain,
        kybProtocol: 'Cleanverse A-Pass',
      },
    } : {}),

    // Payment instructions
    instructions: {
      sendTo:  body.issuerAddress,
      asset:   body.settlementSymbol,
      amount:  body.amount,
      memo:    `vino Invoice #${body.tokenId} — ${body.currency} ${body.amount}`,
      network: 'Monad Testnet (Chain ID 10143)',
    },

    compliance: {
      travelRule:  'FATF Recommendation 16',
      kybRequired: true,
      note:        'Both originator and beneficiary must hold a valid Cleanverse A-Pass. Settlement is gated on-chain by MockCVI.isVerified().',
    },
  }

  return NextResponse.json({ request, source: 'local' })
}

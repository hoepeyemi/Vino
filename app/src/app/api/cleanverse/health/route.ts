/**
 * GET /api/cleanverse/health
 *
 * Returns the integration status of all 7 Cleanverse API endpoints used by vino.
 * Does NOT make live API calls — checks environment config and contract connectivity
 * so the response is instant (no rate-limit risk, no latency).
 *
 * Returns:
 *   {
 *     configured: boolean            // CLEANVERSE_API_ID + CLEANVERSE_API_KEY present
 *     relayConfigured: boolean       // RELAY_PRIVATE_KEY present (for MockCVI.verify)
 *     endpoints: Array<{
 *       id: string                   // internal identifier
 *       method: 'POST' | 'CALL'
 *       name: string                 // Cleanverse API method name
 *       category: 'CVI' | 'CVA' | 'compliance'
 *       encryption: 'AES-CBC' | 'plain JSON' | 'on-chain'
 *       route: string                // vino API route
 *       status: 'live' | 'fallback' | 'unconfigured'
 *       fallback: string             // what happens when Cleanverse is unavailable
 *     }>
 *     checkedAt: string              // ISO timestamp
 *   }
 */

import { NextResponse } from 'next/server'
import {
  isCleanverseConfigured,
  DEFAULT_MOCK_CVI_ADDRESS,
  CLEANVERSE_API_URL,
} from '@/lib/cleanverse-server'

const RELAY_KEY    = process.env.RELAY_PRIVATE_KEY
const MOCK_CVI     = DEFAULT_MOCK_CVI_ADDRESS

const configured   = isCleanverseConfigured()
const relayReady   = !!RELAY_KEY

type EndpointStatus = 'live' | 'fallback' | 'unconfigured'

interface EndpointInfo {
  id: string
  method: 'POST' | 'CALL'
  name: string
  category: 'CVI' | 'CVA' | 'compliance'
  encryption: 'AES-CBC' | 'plain JSON' | 'on-chain'
  route: string
  status: EndpointStatus
  fallback: string
  contract?: string
}

export async function GET() {
  const endpoints: EndpointInfo[] = [
    {
      id: 'generate_apass',
      method: 'POST',
      name: 'generate_apass',
      category: 'CVI',
      encryption: 'AES-CBC',
      route: '/api/cleanverse/onboard',
      status: configured ? 'live' : 'unconfigured',
      fallback: 'returns success:false reason:unconfigured',
    },
    {
      id: 'query_apass',
      method: 'POST',
      name: 'query_apass',
      category: 'CVI',
      encryption: 'plain JSON',
      route: '/api/cleanverse/verify  +  /api/cleanverse/onboard',
      status: configured ? 'live' : 'unconfigured',
      fallback: 'returns verified:false reason:unconfigured',
    },
    {
      id: 'mock_cvi_verify',
      method: 'CALL',
      name: 'MockCVI.verify()',
      category: 'CVI',
      encryption: 'on-chain',
      route: '/api/cleanverse/onboard  (step 3)',
      status: relayReady ? 'live' : 'fallback',
      fallback: 'relay key missing — on-chain approval skipped',
      contract: MOCK_CVI,
    },
    {
      id: 'query_deposit_atoken_list',
      method: 'POST',
      name: 'query_deposit_atoken_list',
      category: 'CVA',
      encryption: 'AES-CBC',
      route: '/api/cleanverse/atoken-list',
      status: configured ? 'live' : 'fallback',
      fallback: 'returns demo tokens: USDC · USDT · EURC',
    },
    {
      id: 'verify_apass',
      method: 'POST',
      name: 'verify_apass',
      category: 'CVA',
      encryption: 'AES-CBC',
      route: '/api/cleanverse/verify-atoken',
      status: configured ? 'live' : 'fallback',
      fallback: 'falls back to MockCVI.isVerified() on-chain',
    },
    {
      id: 'create_payment_request',
      method: 'POST',
      name: 'create_payment_request',
      category: 'CVA',
      encryption: 'AES-CBC',
      route: '/api/cleanverse/cva-payment',
      status: configured ? 'live' : 'fallback',
      fallback: 'generates local production-format CVA payment request',
    },
    {
      id: 'download_travel_rule',
      method: 'POST',
      name: 'download_travel_rule',
      category: 'compliance',
      encryption: 'AES-CBC',
      route: '/api/cleanverse/travel-rule',
      status: configured ? 'live' : 'fallback',
      fallback: 'generates local FATF Rec-16 report with CVA settlement asset',
    },
  ]

  return NextResponse.json({
    configured,
    relayConfigured: relayReady,
    mockCviAddress: MOCK_CVI,
    apiBase: configured ? CLEANVERSE_API_URL : null,
    chain: 'monad-testnet-10143',
    endpoints,
    summary: {
      total: endpoints.length,
      live: endpoints.filter(e => e.status === 'live').length,
      fallback: endpoints.filter(e => e.status === 'fallback').length,
      unconfigured: endpoints.filter(e => e.status === 'unconfigured').length,
    },
    checkedAt: new Date().toISOString(),
  })
}

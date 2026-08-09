/**
 * Cleanverse API client for the vino agent.
 *
 * Implements the A-Pass Management module (Cleanverse API v5.6),
 * which fully supports Monad testnet:
 *   - generateAPass  → POST /generate_apass  (encrypted)
 *   - queryAPass     → POST /query_apass     (plain JSON)
 *   - updateStatus   → POST /update_status   (encrypted)
 *
 * AES encryption:
 *   Algorithm : AES-CBC, PKCS7 padding
 *   IV        : 16 zero bytes
 *   Key       : Buffer.from(CLEANVERSE_API_KEY, 'base64')
 *   Output    : { data: "<Base64 ciphertext>" }
 */

import crypto from 'crypto'

const API_ID = process.env.CLEANVERSE_API_ID
const API_KEY = process.env.CLEANVERSE_API_KEY
const API_URL = process.env.CLEANVERSE_API_URL ?? 'https://uatapi.cleanverse.com/api/cooperate'

export type APassStatus = {
  cvRecordId: string
  tier: string
  subTier: number
  status: 1 | 2          // 1 = active, 2 = frozen
  expirationTime: number // Unix seconds
  group: string
  subGroup: string
  countries: string[]
}

// ── AES helpers ───────────────────────────────────────────────────────────────

function aesEncrypt(obj: unknown): string {
  if (!API_KEY) throw new Error('CLEANVERSE_API_KEY is not set')
  const key = Buffer.from(API_KEY, 'base64')
  const iv = Buffer.alloc(16, 0)
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-cbc`, key, iv)
  const out = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  return out.toString('base64')
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  if (!API_ID) throw new Error('CLEANVERSE_API_ID is not set')
  return {
    'Content-Type': 'application/json',
    'api-id': API_ID,
    'X-Request-ID': crypto.randomUUID(),
  }
}

async function postEncrypted<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ data: aesEncrypt(body) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Cleanverse ${endpoint}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function postPlain<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Cleanverse ${endpoint}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns true when Cleanverse credentials are configured. */
export function isConfigured(): boolean {
  return Boolean(API_ID && API_KEY)
}

/**
 * Register a wallet with Cleanverse KYB (POST /generate_apass).
 * customerId must be ≥12 alphanumeric characters (A-Z, a-z, 0-9 only).
 */
export async function generateAPass(params: {
  walletAddress: string
  chain?: string
  customerId: string
  expirationTime?: number
  kycSource?: string
  kycId?: string
  identityData?: {
    idType: 'PASSPORT' | 'ID_CARD' | 'DRIVER_LICENSE' | 'HK_MACAO_TAIWAN_PASS' | 'RESIDENCE_PERMIT'
    fullName: string
    idNumber?: string
    validUntil?: string
    issuingCountryISO2: string
  }[]
}): Promise<{ success: boolean; cvRecordId?: string; txHash?: string; error?: string }> {
  const chain = params.chain ?? 'monad'
  const expirationTime = params.expirationTime ?? Math.floor(Date.now() / 1000) + 3 * 365 * 86400

  const body: Record<string, unknown> = {
    customerId: params.customerId,
    expirationTime,
    wallet: { address: params.walletAddress, chain },
  }
  if (params.kycSource) body.kycSource = params.kycSource
  if (params.kycId) body.kycId = params.kycId
  if (params.identityData?.length) body.identityDataList = params.identityData

  type Resp = {
    code: string
    message: string
    data: { cvRecordId?: string; wallet?: { txHash?: string } } | string
  }
  const resp = await postEncrypted<Resp>('generate_apass', body)

  if (resp.code === '0000' && resp.data && typeof resp.data === 'object') {
    return {
      success: true,
      cvRecordId: resp.data.cvRecordId,
      txHash: resp.data.wallet?.txHash,
    }
  }
  // code 1000: A-Pass already exists (docs: retry with override=true, or treat as registered)
  if (resp.code === '1000') {
    return { success: true }
  }
  return { success: false, error: resp.message }
}

/**
 * Query A-Pass status for a wallet (POST /query_apass).
 * Returns null when no A-Pass is registered for the address.
 */
export async function queryAPass(
  walletAddress: string,
  chain = 'monad',
): Promise<APassStatus | null> {
  type Resp = { code: string; message: string; data: APassStatus | string }
  const resp = await postPlain<Resp>('query_apass', { chain, address: walletAddress })
  if (resp.code === '0000' && resp.data && typeof resp.data === 'object') {
    return resp.data as APassStatus
  }
  return null
}

/**
 * Freeze (status=2) or activate (status=1) an A-Pass (POST /update_status).
 * Provide either customerId or cvRecordId to identify the record.
 *
 * TODO: call this when invoices are settled (status=2 to freeze) or revoked
 * (status=1 to re-activate) so the A-Pass lifecycle stays in sync with the
 * on-chain invoice state tracked by InvoiceNFT.updateStatus().
 */
export async function updateStatus(params: {
  walletAddress: string
  chain: string
  status: 1 | 2
  customerId?: string
  cvRecordId?: string
  reason?: string
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const body: Record<string, unknown> = {
    status: String(params.status),
    wallet: { chain: params.chain, address: params.walletAddress },
  }
  if (params.customerId) body.customerId = params.customerId
  if (params.cvRecordId) body.cvRecordId = params.cvRecordId
  if (params.reason) body.blacklistReason = params.reason

  type Resp = { code: string; message: string; data: { txHash?: string } | null }
  const resp = await postEncrypted<Resp>('update_status', body)

  if (resp.code === '0000') {
    return { success: true, txHash: resp.data?.txHash }
  }
  return { success: false, error: resp.message }
}

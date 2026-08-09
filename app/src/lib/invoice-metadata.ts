/**
 * Client-side invoice metadata store.
 *
 * The InvoiceNFT contract stores only a keccak256 commitment hash on-chain.
 * Full invoice metadata (client name, amount, CVA settlement token, etc.) is
 * persisted here in localStorage, keyed by tokenId.  The on-chain commitment
 * is the cryptographic proof; this store provides the human-readable display
 * data that a production app would keep in IPFS or a VASP database.
 */

export interface InvoiceMetadata {
  clientName?: string
  amount?: string
  currency?: string
  dueDate?: string
  /** CVA A-Token address selected as the settlement currency on mint. */
  settlementToken?: string
  /** Human-readable symbol of the settlement A-Token (e.g. "USDC"). */
  settlementSymbol?: string
  /** URL / address of the settlement A-Token contract (if known). */
  settlementContractAddress?: string
  quickbooksId?: string | null
  allowDisclosure?: boolean
  /** 0x transaction hash of the mint transaction — auto-populates the Travel Rule form. */
  mintTxHash?: string
  /**
   * 0x transaction hash of the MockCVI.verify() call that approved this wallet on-chain.
   * Captured during KYB onboarding; links the Cleanverse A-Pass to the Monad chain.
   * Shown as an Explorer link in the compliance trail: CVI VERIFIED → on-chain proof.
   */
  cviTxHash?: string
  /**
   * Cleanverse A-Pass record ID returned by generate_apass / query_apass.
   * Shown in the compliance trail as proof of the Cleanverse identity record.
   */
  cviRecordId?: string
  /** Unix timestamp (ms) of when the metadata was saved. */
  savedAt?: number
}

const PREFIX = 'vino-invoice-'

export function saveInvoiceMetadata(
  tokenId: string | number,
  data: InvoiceMetadata,
): void {
  try {
    if (typeof window === 'undefined') return
    localStorage.setItem(
      `${PREFIX}${tokenId}`,
      JSON.stringify({ ...data, savedAt: Date.now() }),
    )
  } catch {
    /* Ignore SSR / private-browsing storage errors */
  }
}

export function loadInvoiceMetadata(
  tokenId: string | number | undefined,
): InvoiceMetadata | null {
  try {
    if (typeof window === 'undefined' || tokenId === undefined) return null
    const raw = localStorage.getItem(`${PREFIX}${tokenId}`)
    return raw ? (JSON.parse(raw) as InvoiceMetadata) : null
  } catch {
    return null
  }
}

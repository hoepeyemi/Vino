"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { useAccount, useChainId, useReadContract } from "wagmi"
import { ArrowLeft, ExternalLink, Shield, CircleAlert, Loader2, FileText, CheckCircle2, Check } from "lucide-react"
import { parseUnits } from "viem"
import { toast } from "sonner"
import { useInvoice } from "@/hooks/use-invoice-nft"
import { useDeposit, useDepositToVault } from "@/hooks/use-yield-vault"
import { getInvoiceNFTAddress, getMockCVIAddress } from "@/lib/contracts/addresses"
import { MockCVIABI } from "@/lib/contracts/abis"
import { TerminalNav } from "@/components/terminal-nav"
import { StatusBar } from "@/components/ui/status-bar"
import { Button } from "@/components/ui/button"
import { InvoiceDepositForm } from "@/features/portfolio/components/InvoiceDepositForm"
import { loadInvoiceMetadata } from "@/lib/invoice-metadata"
import type { InvoiceMetadata } from "@/lib/invoice-metadata"
import { useCleanverseCVI } from "@/hooks/use-cleanverse-cvi"

function formatDate(value: Date | undefined) {
  return value ? value.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "Unknown"
}

const TR_ERROR_MESSAGES: Record<string, string> = {
  invalid_tx_hash: 'Invalid transaction hash — must be 0x followed by 64 hex characters.',
  invalid_address: 'No wallet connected. Connect your wallet to generate a report.',
  unconfigured:    'Travel Rule service is not available.',
  rate_limited:    'Too many requests. Try again in an hour.',
  internal_error:  'Report generation failed. Try again later.',
}

function InvoiceDetailContent() {
  const params = useParams<{ tokenId: string }>()
  const chainId = useChainId()
  const { address: connectedAddress } = useAccount()
  const contractAddress = getInvoiceNFTAddress(chainId)
  const [showDeposit, setShowDeposit] = useState(false)
  const [pendingDeposit, setPendingDeposit] = useState<{ principal: string; strategy: number } | null>(null)
  const [trTxHash, setTrTxHash] = useState("")
  const [trLoading, setTrLoading] = useState(false)
  const [trUrl, setTrUrl] = useState<string | null>(null)
  const [trBlobUrl, setTrBlobUrl] = useState<string | null>(null)
  const [trError, setTrError] = useState<string | null>(null)
  // Parsed FATF report data for inline preview — set alongside trBlobUrl
  const [trReport, setTrReport] = useState<Record<string, unknown> | null>(null)
  // 'cleanverse' when Cleanverse API returned a hosted report, 'local' for testnet fallback
  const [trSource, setTrSource] = useState<string | null>(null)
  const [cvaTokens, setCvaTokens] = useState<{ atoken: string; symbol: string }[]>([])
  const [cvaLoading, setCvaLoading] = useState(true)
  const [cvaEligibility, setCvaEligibility] = useState<Record<string, boolean | null>>({})
  const [invoiceMeta, setInvoiceMeta] = useState<InvoiceMetadata | null>(null)
  const [cvaPaymentRequest, setCvaPaymentRequest] = useState<Record<string, unknown> | null>(null)
  const [cvaPaymentLoading, setCvaPaymentLoading] = useState(false)
  const [cvaPaymentError, setCvaPaymentError] = useState<string | null>(null)
  // Stable blob URL for the CVA payment request JSON download.
  // Created/revoked in a useEffect — never computed inline in JSX.
  const [cvaPaymentBlobUrl, setCvaPaymentBlobUrl] = useState<string | null>(null)
  const [cvaPaymentCopied, setCvaPaymentCopied] = useState(false)
  // 'cleanverse' when the live API responded, 'local' when testnet fallback was used
  const [cvaPaymentSource, setCvaPaymentSource] = useState<string | null>(null)
  // Guard so the deposit-success toast fires exactly once per deposit flow.
  // isDepositSuccess stays true for the lifetime of the component after a tx confirms;
  // without this, every re-render (including those triggered by refetchDeposit) would
  // re-run the effect and show the toast again.
  const depositSuccessHandled = useRef(false)
  const tokenId = useMemo(() => {
    const raw = params?.tokenId
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? parsed : undefined
  }, [params?.tokenId])

  const { state: cviState } = useCleanverseCVI()

  // ── Live on-chain CVI gate ─────────────────────────────────────────────────
  // Calls MockCVI.isVerified(connectedAddress) directly on Monad — proves the
  // on-chain gate is real and always-queryable, not just a stored historical record.
  const mockCVIAddress = getMockCVIAddress(chainId)
  const mockCVIDeployed = !/^0x0+$/.test(mockCVIAddress)
  const { data: liveOnchainVerified, isLoading: isLiveCheckLoading } = useReadContract({
    address: mockCVIAddress,
    abi: MockCVIABI,
    functionName: 'isVerified',
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: !!connectedAddress && mockCVIDeployed,
      staleTime: 30_000,      // cache 30 s — on-chain state rarely changes
      refetchInterval: 60_000, // re-query every 60 s for fresh display
    },
  })

  const { invoice, isLoading, error } = useInvoice(tokenId)
  const { deposit, refetch: refetchDeposit } = useDeposit(tokenId)
  const {
    approve,
    deposit: depositToVault,
    isApproving,
    isApproveConfirming,
    isApproveSuccess,
    isDepositing,
    isDepositConfirming,
    isDepositSuccess,
    resetApprove,
  } = useDepositToVault()

  useEffect(() => {
    if (!isApproveSuccess || !pendingDeposit || tokenId === undefined) {
      return
    }

    depositToVault({
      tokenId: BigInt(tokenId),
      strategy: pendingDeposit.strategy as 0 | 1 | 2,
      principal: parseUnits(pendingDeposit.principal, 18),
    })
    setPendingDeposit(null)
  }, [isApproveSuccess, pendingDeposit, depositToVault, tokenId])

  useEffect(() => {
    if (!isDepositSuccess || depositSuccessHandled.current) return
    depositSuccessHandled.current = true
    toast.success("Invoice deposited for yield", {
      description: "The invoice is now active in the yield vault.",
    })
    setShowDeposit(false)
    setPendingDeposit(null)
    resetApprove()
    refetchDeposit()
  // resetApprove and refetchDeposit are intentionally excluded: they are unstable
  // references (new function objects each render) and are called only once via the
  // ref guard above, so stale-closure risk is zero.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDepositSuccess])

  // Revoke any Travel Rule blob URL when the component unmounts
  useEffect(() => {
    return () => {
      if (trBlobUrl) URL.revokeObjectURL(trBlobUrl)
    }
  // Run only on unmount — trBlobUrl changes are handled inline in handleTravelRule
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load persisted invoice metadata (CVA token, client name, amount, mint TX hash, etc.)
  // and auto-populate the Travel Rule TX hash field if the metadata has it.
  useEffect(() => {
    if (tokenId !== undefined) {
      const meta = loadInvoiceMetadata(tokenId)
      setInvoiceMeta(meta)
      if (meta?.mintTxHash) {
        setTrTxHash(prev => prev || meta.mintTxHash!)
      }
    }
  // trTxHash excluded: setTrTxHash uses a functional update (prev => ...) so the
  // current trTxHash value is never read directly, only written — no dep needed.
  }, [tokenId])

  // Manage the blob URL for CVA payment request download.
  // Revokes the old URL whenever the request changes and on unmount.
  useEffect(() => {
    if (!cvaPaymentRequest) {
      setCvaPaymentBlobUrl(null)
      return
    }
    const blob = new Blob([JSON.stringify(cvaPaymentRequest, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    setCvaPaymentBlobUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [cvaPaymentRequest])

  // Fetch CVA A-Token list on mount
  useEffect(() => {
    void fetch('/api/cleanverse/atoken-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'monad' }),
    })
      .then(r => r.json())
      .then((data: { tokens?: { atoken: string; symbol: string }[] }) => {
        setCvaTokens(data.tokens ?? [])
      })
      .catch(() => {})
      .finally(() => setCvaLoading(false))
  }, [])

  // Check wallet CVA eligibility for each token
  useEffect(() => {
    if (!connectedAddress || cvaTokens.length === 0) return
    const initial: Record<string, boolean | null> = {}
    cvaTokens.forEach(t => { initial[t.atoken] = null })
    setCvaEligibility(initial)
    cvaTokens.forEach(token => {
      void fetch('/api/cleanverse/verify-atoken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: connectedAddress, atoken: token.atoken, chain: 'monad' }),
      })
        .then(r => r.json())
        .then((data: { verified?: boolean }) => {
          setCvaEligibility(prev => ({ ...prev, [token.atoken]: data.verified ?? false }))
        })
        .catch(() => {
          setCvaEligibility(prev => ({ ...prev, [token.atoken]: false }))
        })
    })
  }, [connectedAddress, cvaTokens])

  const handleDeposit = (principal: string, selectedStrategy: number) => {
    if (tokenId === undefined) return

    setPendingDeposit({ principal, strategy: selectedStrategy })
    approve(BigInt(tokenId))
  }

  const handleCvaPaymentRequest = async () => {
    if (!connectedAddress || !invoice?.issuer) return
    setCvaPaymentLoading(true)
    setCvaPaymentError(null)
    setCvaPaymentRequest(null)
    try {
      const res = await fetch('/api/cleanverse/cva-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: tokenId?.toString(),
          amount: invoiceMeta?.amount ?? '0',
          currency: invoiceMeta?.currency ?? 'USD',
          settlementToken: invoiceMeta?.settlementToken ?? cvaTokens[0]?.atoken ?? '',
          settlementSymbol: invoiceMeta?.settlementSymbol ?? cvaTokens[0]?.symbol ?? '',
          issuerAddress: invoice.issuer,
          payerAddress: connectedAddress,
          chain: 'monad',
        }),
      })
      const data = await res.json() as { request?: Record<string, unknown>; error?: string; source?: string }
      if (data.request) {
        setCvaPaymentRequest(data.request)
        setCvaPaymentSource(data.source ?? 'local')
      } else {
        setCvaPaymentError(data.error ?? 'Failed to generate payment request')
      }
    } catch {
      setCvaPaymentError('Network error. Try again.')
    } finally {
      setCvaPaymentLoading(false)
    }
  }

  const handleTravelRule = async () => {
    if (!connectedAddress) {
      setTrError(TR_ERROR_MESSAGES.invalid_address)
      return
    }
    setTrLoading(true)
    setTrError(null)
    setTrUrl(null)
    setTrReport(null)
    setTrSource(null)
    // Revoke any previous local blob to free memory
    if (trBlobUrl) {
      URL.revokeObjectURL(trBlobUrl)
      setTrBlobUrl(null)
    }
    try {
      const res = await fetch('/api/cleanverse/travel-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: trTxHash.trim(),
          address: connectedAddress,
          tokenId: tokenId?.toString(),
          issuerAddress: invoice?.issuer,
          settlementToken: invoiceMeta?.settlementToken,
          settlementSymbol: invoiceMeta?.settlementSymbol,
        }),
      })
      const data = await res.json() as {
        downloadUrl?: string
        report?: Record<string, unknown>
        error?: string
        source?: string
      }
      if (data.downloadUrl?.startsWith('https://')) {
        // Cleanverse returned a hosted PDF/report URL
        setTrUrl(data.downloadUrl)
        setTrSource(data.source ?? 'cleanverse')
      } else if (data.report) {
        // Local FATF report — store for inline preview and create downloadable blob
        setTrReport(data.report)
        setTrSource(data.source ?? 'local')
        const blob = new Blob(
          [JSON.stringify(data.report, null, 2)],
          { type: 'application/json' }
        )
        const blobUrl = URL.createObjectURL(blob)
        setTrBlobUrl(blobUrl)
      } else {
        const code = data.error ?? 'internal_error'
        setTrError(TR_ERROR_MESSAGES[code] ?? 'Unexpected error. Try again later.')
      }
    } catch {
      setTrError('Network error. Check your connection and try again.')
    } finally {
      setTrLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-grid noise-overlay scan-line pb-8">
      <TerminalNav />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/dashboard">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="w-4 h-4" />
              back to portfolio
            </Button>
          </Link>
          <div className="text-[11px] uppercase tracking-[0.25em] text-[#666666]">
            invoice detail
          </div>
        </div>

        <div className="terminal-card p-6 md:p-8">
          {isLoading ? (
            <div className="text-sm text-[#666666]">loading invoice...</div>
          ) : error || !invoice ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#ef4444]">
                <CircleAlert className="w-4 h-4" />
                <h1 className="text-lg font-bold">Invoice not found</h1>
              </div>
              <p className="text-sm text-[#666666]">
                Token #{tokenId ?? "unknown"} is not available on the connected chain yet. If you just minted it, wait for confirmation and refresh the page.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/dashboard/mint">
                  <Button>
                    mint another invoice
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="secondary">
                    view portfolio
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.25em] text-[#666666] mb-2">
                    vino invoice #{tokenId}
                  </div>
                  <h1 className="text-2xl font-bold text-[#10b981]">
                    {deposit?.active ? "Earning Yield" : invoice.statusLabel}
                  </h1>
                  <p className="text-sm text-[#666666] mt-2">
                    Privacy-preserving invoice commitment stored on Monad Testnet.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded border border-[#10b981]/20 bg-[#10b981]/10 px-4 py-2 text-sm">
                  <Shield className="w-4 h-4 text-[#10b981]" />
                  <span className="text-[#d7fff1]">chain secured</span>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#666666] mb-2">commitments</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-[#666666]">data</span>
                      <span className="font-mono text-right break-all">{invoice.dataCommitment}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[#666666]">amount</span>
                      <span className="font-mono text-right break-all">{invoice.amountCommitment}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#666666] mb-2">timeline</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-[#666666]">due date</span>
                      <span>{formatDate(invoice.dueDate)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[#666666]">created</span>
                      <span>{formatDate(invoice.createdAt)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[#666666]">issuer</span>
                      <span className="font-mono text-right break-all">{invoice.issuer}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#666666] mb-3">risk profile</div>
                <div className="grid gap-4 sm:grid-cols-3 text-sm">
                  <div>
                    <div className="text-[#666666]">risk score</div>
                    <div className="mt-1 text-lg font-bold">{invoice.riskScore}/100</div>
                  </div>
                  <div>
                    <div className="text-[#666666]">payment probability</div>
                    <div className="mt-1 text-lg font-bold">{invoice.paymentProbability}/100</div>
                  </div>
                  <div>
                    <div className="text-[#666666]">owner</div>
                    <div className="mt-1 font-mono break-all">{invoice.owner ?? "unavailable"}</div>
                  </div>
                </div>
              </div>

              {!deposit?.active && invoice.status === 0 && (
                <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4 space-y-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-[#666666] mb-1">yield</div>
                    <div className="text-sm text-[#d6d6d6]">
                      This invoice is minted and ready to deposit into the yield vault.
                    </div>
                  </div>

                  {showDeposit ? (
                    <InvoiceDepositForm
                      tokenId={String(tokenId)}
                      isApproving={isApproving}
                      isApproveConfirming={isApproveConfirming}
                      isDepositing={isDepositing}
                      isDepositConfirming={isDepositConfirming}
                      onDeposit={handleDeposit}
                      onCancel={() => setShowDeposit(false)}
                    />
                  ) : (
                    <Button onClick={() => setShowDeposit(true)}>
                      start earning yield
                      {(isApproving || isApproveConfirming || isDepositing || isDepositConfirming) && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                    </Button>
                  )}
                </div>
              )}

              {deposit?.active && (
                <div className="rounded-lg border border-[#10b981]/20 bg-[#10b981]/10 p-4 text-sm">
                  <div className="text-[#10b981] font-semibold mb-2">earning yield</div>
                  <div className="grid gap-2 sm:grid-cols-2 text-[#d6d6d6]">
                    <div>strategy: {deposit.strategyLabel}</div>
                    <div>principal: ${Number(deposit.principal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div>accrued yield: ${Number(deposit.accruedYield).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div>deposited: {formatDate(deposit.depositTime)}</div>
                  </div>
                </div>
              )}

              {/* ── Compliance Audit Trail ─────────────────────────────────────────── */}
              <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-3.5 h-3.5 text-[#10b981]" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">Compliance Trail</span>
                  <span className="text-[10px] text-[#444444]">· CVI → CVA → FATF Rec-16</span>
                </div>
                {/* Live on-chain CVI gate — queries MockCVI.isVerified() in real time */}
                {connectedAddress && mockCVIDeployed && (
                  <div className="mb-3 pb-3 border-b border-[#1f1f1f] flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[9px] font-mono text-[#333333] truncate">
                      ⛓ MockCVI.isVerified({connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)})
                    </span>
                    {isLiveCheckLoading ? (
                      <span className="inline-flex items-center gap-1 text-[9px] text-[#555555]">
                        <Loader2 className="w-2 h-2 animate-spin" />
                        querying…
                      </span>
                    ) : liveOnchainVerified === true ? (
                      <span className="text-[9px] font-semibold font-mono text-[#10b981] px-1.5 py-0.5 rounded border border-[#10b981]/30 bg-[#10b981]/10">
                        VERIFIED ON-CHAIN ✓
                      </span>
                    ) : liveOnchainVerified === false ? (
                      <span className="text-[9px] font-semibold font-mono text-[#ef4444] px-1.5 py-0.5 rounded border border-[#ef4444]/30 bg-[#ef4444]/10">
                        NOT VERIFIED
                      </span>
                    ) : null}
                  </div>
                )}

                <div className="relative">
                  {/* Vertical connecting line */}
                  <div className="absolute left-[6px] top-3 bottom-3 w-px bg-[#1f1f1f] z-0" />

                  {([
                    {
                      done: cviState.status === 'verified',
                      label: 'CVI VERIFIED',
                      detail: cviState.status === 'verified'
                        ? [
                            `Tier ${cviState.tier}`,
                            `A-Pass expires ${new Date(cviState.expirationTime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                            cviState.source === 'cleanverse'
                              ? 'query_apass ✓'
                              : cviState.source === 'mock-cvi-onchain'
                                ? 'MockCVI.isVerified() ✓'
                                : null,
                            // Cleanverse A-Pass record ID — proof the identity was issued by Cleanverse
                            invoiceMeta?.cviRecordId
                              ? `record: ${invoiceMeta.cviRecordId.slice(0, 10)}…`
                              : null,
                            cviState.countries.length > 0
                              ? cviState.countries.slice(0, 3).join(' · ') + (cviState.countries.length > 3 ? ` +${cviState.countries.length - 3}` : '')
                              : null,
                          ].filter(Boolean).join(' · ')
                        : 'KYB verification required — connect verified wallet',
                      // MockCVI.verify() on-chain proof — Explorer link to the relay tx
                      link: invoiceMeta?.cviTxHash
                        ? `https://testnet.monadexplorer.com/tx/${invoiceMeta.cviTxHash}`
                        : undefined as string | undefined,
                      linkLabel: invoiceMeta?.cviTxHash ? 'MockCVI.verify() tx' : undefined as string | undefined,
                    },
                    {
                      done: !!invoice,
                      label: 'INVOICE MINTED',
                      detail: invoice
                        ? `Token #${tokenId} · Monad Testnet (Chain 10143)`
                        : 'Not yet minted',
                      link: invoiceMeta?.mintTxHash
                        ? `https://testnet.monadexplorer.com/tx/${invoiceMeta.mintTxHash}`
                        : undefined,
                      linkLabel: 'view tx',
                    },
                    {
                      done: !!invoiceMeta?.settlementToken,
                      label: 'CVA LOCKED',
                      detail: invoiceMeta?.settlementSymbol
                        ? `${invoiceMeta.settlementSymbol} · Cleanverse Verified Asset (A-Token)`
                        : 'No settlement asset — select at mint',
                      link: invoiceMeta?.settlementContractAddress &&
                            !/^0x0+$/.test(invoiceMeta.settlementContractAddress)
                        ? `https://testnet.monadexplorer.com/address/${invoiceMeta.settlementContractAddress}`
                        : undefined,
                      linkLabel: 'contract',
                    },
                    {
                      done: !!cvaPaymentRequest,
                      label: 'PAYMENT REQUESTED',
                      detail: cvaPaymentRequest
                        ? [
                            `Request ID: ${(cvaPaymentRequest as { requestId?: string }).requestId?.slice(0, 8) ?? ''}…`,
                            '48 h window',
                            // Show which Cleanverse path served the payment request
                            cvaPaymentSource === 'cleanverse'
                              ? 'create_payment_request ✓'
                              : cvaPaymentSource === 'local'
                                ? 'CVA local format'
                                : null,
                          ].filter(Boolean).join(' · ')
                        : 'Click "Request Payment" in CVA Settlement below',
                      link: undefined,
                      linkLabel: undefined,
                    },
                    {
                      done: !!(trBlobUrl || trUrl),
                      label: 'TRAVEL RULE FILED',
                      detail: (trBlobUrl || trUrl)
                        ? 'FATF Rec-16 report generated · includes CVA settlement asset'
                        : 'Click "generate" in Travel Rule section below',
                      link: trUrl ?? undefined,
                      linkLabel: trUrl ? 'download' : undefined,
                    },
                  ]).map((step, i) => (
                    <div key={i} className="relative flex items-start gap-3 py-2.5 pl-5 z-10">
                      {/* Step circle */}
                      <div className={`absolute left-0 top-[10px] w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center z-10 ${
                        step.done
                          ? 'border-[#10b981] bg-[#10b981]'
                          : 'border-[#333333] bg-[#0a0a0a]'
                      }`}>
                        {step.done && <Check className="w-2 h-2 text-black" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[11px] font-semibold tracking-wide ${step.done ? 'text-[#e5e5e5]' : 'text-[#3a3a3a]'}`}>
                          {step.label}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${step.done ? 'text-[#666666]' : 'text-[#333333]'}`}>
                          {step.detail}
                          {step.link && step.linkLabel && (
                            <>
                              {' · '}
                              <a href={step.link} target="_blank" rel="noreferrer"
                                className="text-[#10b981] hover:underline">
                                {step.linkLabel} ↗
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      {step.done && (
                        <span className="shrink-0 text-[9px] text-[#10b981] font-semibold uppercase tracking-wider mt-[2px]">
                          ✓ done
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* CVA Settlement — active settlement flow */}
              <div className="rounded-lg border border-[#10b981]/20 bg-[#111111] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-[#10b981]" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">CVA Settlement</span>
                  <span className="text-[10px] text-[#444444]">· Cleanverse Verified Asset</span>
                </div>

                {/* Settlement token from invoice metadata */}
                {invoiceMeta?.settlementToken ? (
                  <div className="flex items-center gap-3 p-3 rounded border border-[#10b981]/20 bg-[#10b981]/5">
                    <CheckCircle2 className="w-4 h-4 text-[#10b981] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-[#10b981]">
                        Settlement Asset: {invoiceMeta.settlementSymbol}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-[#666666] truncate">
                          A-Token: {invoiceMeta.settlementToken}
                        </p>
                        {invoiceMeta.settlementContractAddress &&
                         !/^0x0+$/.test(invoiceMeta.settlementContractAddress) && (
                          <a
                            href={`https://testnet.monadexplorer.com/address/${invoiceMeta.settlementContractAddress}`}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-[9px] font-mono text-[#10b981]/60 hover:text-[#10b981] hover:underline"
                          >
                            {invoiceMeta.settlementContractAddress.slice(0, 8)}… ↗
                          </a>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#444444] shrink-0">CVI gated</span>
                  </div>
                ) : cvaLoading ? (
                  <div className="flex items-center gap-2 text-[11px] text-[#666666]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    loading A-Tokens…
                  </div>
                ) : cvaTokens.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-[#666666]">
                      No settlement asset was selected at mint. Eligible A-Tokens for this chain:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {cvaTokens.map(t => {
                        const eligible = cvaEligibility[t.atoken]
                        return (
                          <span key={t.atoken} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#1f1f1f] text-[11px] text-[#999999]">
                            {eligible === null ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : eligible ? <CheckCircle2 className="w-2.5 h-2.5 text-[#10b981]" /> : <span className="w-1.5 h-1.5 rounded-full bg-[#444444]" />}
                            {t.symbol ?? t.atoken}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-[#666666]">CVA-settlement compliant. No A-Tokens listed for this chain yet.</p>
                )}

                {/* CVA Payment Request */}
                {(invoiceMeta?.settlementToken || cvaTokens.length > 0) && (
                  <div className="pt-2 border-t border-[#1f1f1f] space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-[#666666]">
                        Generate a CVA-verified payment request for the payer.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={cvaPaymentLoading || !connectedAddress}
                        onClick={() => void handleCvaPaymentRequest()}
                        className="text-[11px] h-7"
                      >
                        {cvaPaymentLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Request Payment"}
                      </Button>
                    </div>

                    {cvaPaymentError && (
                      <p className="text-[11px] text-amber-400">{cvaPaymentError}</p>
                    )}

                    {cvaPaymentRequest && (
                      <div className="rounded border border-[#10b981]/20 bg-[#0a0a0a] p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">Payment Request</span>
                            {cvaPaymentSource && (
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                cvaPaymentSource === 'cleanverse'
                                  ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#10b981]'
                                  : 'border-[#1f1f1f] bg-[#111111] text-[#444444]'
                              }`}>
                                {cvaPaymentSource === 'cleanverse' ? '✓ Cleanverse API' : 'local format'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard
                                  .writeText(JSON.stringify(cvaPaymentRequest, null, 2))
                                  .then(() => {
                                    setCvaPaymentCopied(true)
                                    setTimeout(() => setCvaPaymentCopied(false), 2000)
                                  })
                              }}
                              className="text-[10px] text-[#666666] hover:text-[#10b981] transition-colors"
                            >
                              {cvaPaymentCopied ? '✓ copied' : 'copy'}
                            </button>
                            <a
                              href={cvaPaymentBlobUrl ?? '#'}
                              download={`cva-payment-${tokenId}.json`}
                              className={`text-[10px] transition-colors ${cvaPaymentBlobUrl ? 'text-[#10b981] hover:underline' : 'text-[#444444] pointer-events-none'}`}
                            >
                              download
                            </a>
                          </div>
                        </div>
                        {/* Settlement asset badge */}
                        {(() => {
                          const settle = cvaPaymentRequest.settlement as Record<string,string> | undefined
                          const instr  = cvaPaymentRequest.instructions as Record<string,string> | undefined
                          return settle || instr ? (
                            <div className="space-y-2">
                              {settle && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-[#444444]">Settlement asset:</span>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#10b981]/40 bg-[#10b981]/10 text-[10px] text-[#10b981] font-semibold">
                                    {settle.symbol}
                                  </span>
                                  <span className="text-[9px] text-[#444444]">Cleanverse CVA A-Token</span>
                                </div>
                              )}
                              {instr && (
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] bg-[#0a0a0a] rounded p-2.5 font-mono">
                                  <div>
                                    <span className="text-[#444444]">send_to: </span>
                                    <span className="text-[#d6d6d6]">{String(instr.sendTo ?? '').slice(0,10)}…</span>
                                  </div>
                                  <div>
                                    <span className="text-[#444444]">amount: </span>
                                    <span className="text-[#10b981] font-semibold">{instr.amount} {instr.asset}</span>
                                  </div>
                                  <div>
                                    <span className="text-[#444444]">network: </span>
                                    <span className="text-[#d6d6d6]">Monad Testnet</span>
                                  </div>
                                  <div>
                                    <span className="text-[#444444]">protocol: </span>
                                    <span className="text-[#10b981]">Cleanverse CVA</span>
                                  </div>
                                </div>
                              )}
                              <div className="flex items-start gap-1.5 text-[10px] text-[#444444]">
                                <Shield className="w-3 h-3 text-[#10b981]/60 shrink-0 mt-0.5" />
                                <span>Both parties must hold a valid Cleanverse A-Pass. Settlement gated on-chain via <span className="font-mono text-[#555555]">MockCVI.isVerified()</span>.</span>
                              </div>
                            </div>
                          ) : null
                        })()}
                        <div className="flex items-center gap-4 text-[9px] text-[#333333] pt-1 border-t border-[#1a1a1a]">
                          <span>ID: {String((cvaPaymentRequest as Record<string,string>).requestId ?? '').slice(0,8)}…</span>
                          <span>Expires: {String((cvaPaymentRequest as Record<string,string>).expiresAt ?? '').slice(0,10)}</span>
                          <span className="text-[#10b981]/60">48 h window</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Travel Rule Compliance Report */}
              <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-[#10b981]" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">Travel Rule Report</span>
                  <span className="text-[10px] text-[#444444]">· FATF Rec-16</span>
                  {trSource && (
                    <span className={`ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                      trSource === 'cleanverse'
                        ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#10b981]'
                        : 'border-[#1f1f1f] bg-[#111111] text-[#444444]'
                    }`}>
                      {trSource === 'cleanverse' ? '✓ Cleanverse API' : 'local format'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#666666]">
                  Generate a Travel Rule compliance report for any transaction associated with this invoice.
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0 relative">
                    <input
                      type="text"
                      value={trTxHash}
                      onChange={e => setTrTxHash(e.target.value)}
                      placeholder="0x transaction hash (64 hex chars)"
                      className="w-full rounded border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-1.5 text-[11px] font-mono text-[#d6d6d6] placeholder:text-[#444444] focus:border-[#10b981]/40 focus:outline-none"
                    />
                    {/* Auto-filled indicator — appears when the mint TX hash was stored
                        in localStorage at mint time and pre-populated this field */}
                    {invoiceMeta?.mintTxHash && trTxHash === invoiceMeta.mintTxHash && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[9px] text-[#10b981] font-semibold">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        auto-filled
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={trLoading || !connectedAddress || !/^0x[0-9a-fA-F]{64}$/.test(trTxHash.trim())}
                    onClick={() => void handleTravelRule()}
                  >
                    {trLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "generate"}
                  </Button>
                </div>
                {!connectedAddress && (
                  <p className="text-[11px] text-[#666666]">Connect your wallet to generate a report.</p>
                )}
                {trUrl && (
                  <a
                    href={trUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-[#10b981] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    download report
                  </a>
                )}
                {trBlobUrl && (
                  <a
                    href={trBlobUrl}
                    download={`travel-rule-${trTxHash.slice(0, 10)}.json`}
                    className="inline-flex items-center gap-1.5 text-[11px] text-[#10b981] hover:underline"
                  >
                    <FileText className="w-3 h-3" />
                    download report (JSON)
                  </a>
                )}

                {/* Inline report preview — surfaces the key compliance fields */}
                {trReport && (() => {
                  const orig   = trReport.originator as Record<string,string> | undefined
                  const bene   = trReport.beneficiary as Record<string,string> | undefined
                  const settle = trReport.settlementAsset as Record<string,string> | undefined
                  const comp   = trReport.compliance   as Record<string,string> | undefined
                  const tx     = trReport.transaction  as Record<string,string> | undefined
                  return (
                    <div className="mt-1 rounded border border-[#10b981]/20 bg-[#0a0a0a] p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.15em] text-[#10b981] font-semibold">FATF Rec-16 Preview</span>
                        <span className="text-[9px] text-[#444444]">{String(trReport.standard ?? '')}</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 text-[10px]">
                        {tx?.hash && (
                          <div className="flex items-center gap-2">
                            <span className="text-[#444444] w-20 shrink-0">tx hash:</span>
                            <a href={tx.explorerUrl} target="_blank" rel="noreferrer"
                              className="font-mono text-[#10b981] hover:underline truncate">
                              {tx.hash.slice(0, 18)}… ↗
                            </a>
                          </div>
                        )}
                        {orig?.walletAddress && (
                          <div className="flex items-center gap-2">
                            <span className="text-[#444444] w-20 shrink-0">originator:</span>
                            <span className="font-mono text-[#d6d6d6]">{orig.walletAddress.slice(0,12)}…</span>
                            <span className="text-[9px] text-[#555555]">A-Pass KYB</span>
                          </div>
                        )}
                        {bene?.walletAddress && (
                          <div className="flex items-center gap-2">
                            <span className="text-[#444444] w-20 shrink-0">beneficiary:</span>
                            <span className="font-mono text-[#d6d6d6]">{bene.walletAddress.slice(0,12)}…</span>
                            <span className="text-[9px] text-[#555555]">invoice issuer</span>
                          </div>
                        )}
                        {settle?.symbol && (
                          <div className="flex items-center gap-2">
                            <span className="text-[#444444] w-20 shrink-0">settlement:</span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981] font-semibold text-[9px]">
                              {settle.symbol}
                            </span>
                            <span className="text-[9px] text-[#555555]">{settle.protocol}</span>
                          </div>
                        )}
                        {comp?.cvaProtocol && (
                          <div className="flex items-center gap-2">
                            <span className="text-[#444444] w-20 shrink-0">cva rail:</span>
                            <span className="text-[#d6d6d6]">{comp.cvaProtocol}</span>
                          </div>
                        )}
                      </div>
                      <div className="pt-1.5 border-t border-[#1a1a1a] text-[9px] text-[#333333]">
                        Generated by vino Protocol · {String(trReport.generatedAt ?? '').slice(0, 19).replace('T', ' ')}
                      </div>
                    </div>
                  )
                })()}

                {trError && (
                  <p className="text-[11px] text-amber-400">{trError}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <Link href={`/dashboard/mint?invoice=${tokenId}`}>
                  <Button>
                    mint another
                  </Button>
                </Link>
                <a
                  href={`https://testnet.monadexplorer.com/nft/${contractAddress}/${tokenId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded border border-[#1f1f1f] px-4 py-2 text-sm text-[#d6d6d6] hover:border-[#10b981]/40 hover:text-white transition-colors"
                >
                  explorer
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          )}
        </div>
      </main>

      <StatusBar status="online" network="Monad Testnet" />
    </div>
  )
}

export default function InvoiceDetailPage() {
  return <InvoiceDetailContent />
}

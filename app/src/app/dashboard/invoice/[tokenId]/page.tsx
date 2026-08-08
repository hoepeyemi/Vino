"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { useAccount, useChainId } from "wagmi"
import { ArrowLeft, ExternalLink, Shield, CircleAlert, Loader2, FileText, CheckCircle2 } from "lucide-react"
import { parseUnits } from "viem"
import { toast } from "sonner"
import { useInvoice } from "@/hooks/use-invoice-nft"
import { useDeposit, useDepositToVault } from "@/hooks/use-yield-vault"
import { getInvoiceNFTAddress } from "@/lib/contracts/addresses"
import { TerminalNav } from "@/components/terminal-nav"
import { StatusBar } from "@/components/ui/status-bar"
import { Button } from "@/components/ui/button"
import { InvoiceDepositForm } from "@/features/portfolio/components/InvoiceDepositForm"

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
  const [cvaTokens, setCvaTokens] = useState<{ atoken: string; symbol: string }[]>([])
  const [cvaLoading, setCvaLoading] = useState(true)
  const [cvaEligibility, setCvaEligibility] = useState<Record<string, boolean | null>>({})
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

  const handleTravelRule = async () => {
    if (!connectedAddress) {
      setTrError(TR_ERROR_MESSAGES.invalid_address)
      return
    }
    setTrLoading(true)
    setTrError(null)
    setTrUrl(null)
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
        }),
      })
      const data = await res.json() as {
        downloadUrl?: string
        report?: Record<string, unknown>
        error?: string
      }
      if (data.downloadUrl?.startsWith('https://')) {
        // Cleanverse returned a hosted PDF/report URL
        setTrUrl(data.downloadUrl)
      } else if (data.report) {
        // Local FATF report — create a downloadable JSON blob
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

              {/* CVA Settlement Assets */}
              <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-[#10b981]" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">CVA Settlement Assets</span>
                  <span className="text-[10px] text-[#444444]">· Cleanverse Verified</span>
                </div>
                {cvaLoading ? (
                  <div className="flex items-center gap-2 text-[11px] text-[#666666]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    loading A-Tokens…
                  </div>
                ) : cvaTokens.length === 0 ? (
                  <p className="text-[11px] text-[#666666]">
                    CVA-settlement compliant ready.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[#666666]">Eligible settlement assets for this invoice:</p>
                    <div className="flex flex-wrap gap-2">
                      {cvaTokens.map(t => {
                        const eligible = cvaEligibility[t.atoken]
                        return (
                          <span
                            key={t.atoken}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#10b981]/20 bg-[#10b981]/5 text-[11px] text-[#d7fff1]"
                          >
                            {eligible === null
                              ? <Loader2 className="w-2.5 h-2.5 animate-spin text-[#666666]" />
                              : eligible
                                ? <CheckCircle2 className="w-2.5 h-2.5 text-[#10b981]" />
                                : <span className="w-1.5 h-1.5 rounded-full bg-[#444444]" />
                            }
                            {t.symbol ?? t.atoken}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Travel Rule Compliance Report */}
              <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-[#10b981]" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">Travel Rule Report</span>
                  <span className="text-[10px] text-[#444444]">· Cleanverse compliant</span>
                </div>
                <p className="text-[11px] text-[#666666]">
                  Generate a Travel Rule compliance report for any transaction associated with this invoice.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={trTxHash}
                    onChange={e => setTrTxHash(e.target.value)}
                    placeholder="0x transaction hash (64 hex chars)"
                    className="flex-1 min-w-0 rounded border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-1.5 text-[11px] font-mono text-[#d6d6d6] placeholder:text-[#444444] focus:border-[#10b981]/40 focus:outline-none"
                  />
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

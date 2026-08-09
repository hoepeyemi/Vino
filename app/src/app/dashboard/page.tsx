"use client"

/**
 * vino Dashboard - Terminal/Bloomberg Aesthetic
 * Monospace, data-dense, green accents
 * ALIVE: Grid background, stagger animations, pulse effects
 */

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useAccount } from "wagmi"
import { useInvoiceNFT } from "@/hooks/use-invoice-nft"
import { useYieldVault } from "@/hooks/use-yield-vault"
import { useCleanverseCVI } from "@/hooks/use-cleanverse-cvi"
import { formatUnits } from "viem"
import { Plus, ArrowUpRight, RefreshCw, Shield, ShieldCheck, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBar } from "@/components/ui/status-bar"
import { TerminalNav } from "@/components/terminal-nav"
import { MiniActivityFeed } from "@/components/mini-activity-feed"
import { loadInvoiceMetadata } from "@/lib/invoice-metadata"

interface InvoiceResponse {
  tokenId: string
  dueDate: string
  status: string
  riskScore?: number
  deposit?: {
    principal: string
    accruedYield: string
    strategy?: string
    strategyCode?: number
  }
}

interface InvoiceDisplay {
  id: string
  tokenId: string
  amount: string
  amountRaw: number
  dueDate: string
  daysUntilDue: number
  strategy: string
  apy: string
  accruedYield: string
  status: string
  riskScore: number
}

function strategyLabelFrom(inv: InvoiceResponse): string {
  if (typeof inv.deposit?.strategy === "string" && inv.deposit.strategy.length > 0) {
    return inv.deposit.strategy.toLowerCase()
  }

  switch (inv.deposit?.strategyCode) {
    case 0:
      return "hold"
    case 1:
      return "conservative"
    case 2:
      return "aggressive"
    default:
      return "—"
  }
}

export default function Dashboard() {
  const [invoices, setInvoices] = useState<InvoiceDisplay[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  // Live accrued yield summed from all active deposits (contract's totalYieldGenerated
  // only increments on withdrawal, so it reads 0 while yield is still accruing).
  const [liveAccruedYield, setLiveAccruedYield] = useState(0)
  // CVA settlement symbol per invoice (tokenId → symbol).
  // Loaded from localStorage in a useEffect — never called synchronously in render.
  const [invoiceCvaMap, setInvoiceCvaMap] = useState<Record<string, string>>({})

  const { isConnected } = useAccount()
  const { totalInvoices } = useInvoiceNFT()
  const { tvl, activeDepositsCount, conservativeAPY, aggressiveAPY } = useYieldVault()
  const { state: cviState } = useCleanverseCVI()

  const fetchInvoices = useCallback(async () => {
    if (!isConnected) {
      setInvoices([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/invoices?active=true`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (data.success && data.data.invoices) {
        let totalAccrued = 0
        const formattedInvoices: InvoiceDisplay[] = data.data.invoices.map((inv: InvoiceResponse) => {
          const dueDate = new Date(inv.dueDate)
          const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          const principal = inv.deposit ? Number(formatUnits(BigInt(inv.deposit.principal), 18)) : 0
          const accrued = inv.deposit ? Number(formatUnits(BigInt(inv.deposit.accruedYield), 18)) : 0
          totalAccrued += accrued
          const strategy = strategyLabelFrom(inv)
          const isInYield = Boolean(inv.deposit) || inv.status === "InYield"

          return {
            id: `INV-${String(inv.tokenId).padStart(4, "0")}`,
            tokenId: inv.tokenId,
            amount: `$${principal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            amountRaw: principal,
            dueDate: dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            daysUntilDue,
            strategy,
            apy: strategy === "aggressive" ? `${aggressiveAPY}%` : strategy === "conservative" ? `${conservativeAPY}%` : "—",
            accruedYield: inv.deposit ? `+$${accrued.toFixed(2)}` : "$0.00",
            status: isInYield ? "InYield" : inv.status,
            riskScore: inv.riskScore || 75,
          }
        })
        setInvoices(formattedInvoices)
        setLiveAccruedYield(totalAccrued)
      }
    } catch (err) {
      console.error("Failed to fetch invoices:", err)
      setError("Failed to load invoices")
    } finally {
      setIsLoading(false)
    }
  }, [isConnected, conservativeAPY, aggressiveAPY])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // Load CVA metadata for all invoices after the invoice list updates.
  // Kept in a separate effect so localStorage reads never block the render thread.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const map: Record<string, string> = {}
    invoices.forEach(inv => {
      const meta = loadInvoiceMetadata(inv.tokenId)
      if (meta?.settlementSymbol) {
        map[inv.tokenId] = meta.settlementSymbol
      }
    })
    setInvoiceCvaMap(map)
  }, [invoices])

  useEffect(() => {
    const refresh = () => { void fetchInvoices() }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [fetchInvoices])

  const filteredInvoices = invoices.filter((inv) =>
    inv.id.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // useYieldVault already returns formatUnits strings — parsing them again via
  // BigInt() throws a SyntaxError on decimal strings (e.g. "10000.0"), so use
  // Number() directly on the pre-formatted value.
  const tvlFormatted = Number(tvl || 0)
  const yieldFormatted = liveAccruedYield

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-grid noise-overlay scan-line pb-8">
      <TerminalNav />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-8 stagger-1">
          <div>
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-1">
              Total Portfolio Value
            </div>
            <div className="text-[32px] font-bold tabular-nums">
              <span className="text-[#666666]">$</span>
              <span className="text-[#10b981]">{tvlFormatted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
          <Link href="/dashboard/mint">
            <Button>
              <Plus className="w-4 h-4" />
              mint invoice
            </Button>
          </Link>
        </div>

        {/* CVI status strip — shows live Cleanverse identity state */}
        {isConnected && cviState.status !== 'idle' && cviState.status !== 'unconfigured' && (
          <div className="flex items-center gap-3 mb-4 p-2.5 rounded border border-[#1a1a1a] bg-[#0d0d0d] text-[10px] font-mono">
            {cviState.status === 'loading' && (
              <>
                <Shield className="w-3 h-3 text-[#444444] animate-pulse" />
                <span className="text-[#444444]">checking Cleanverse CVI status…</span>
              </>
            )}
            {cviState.status === 'verified' && (
              <>
                <ShieldCheck className="w-3 h-3 text-[#10b981]" />
                <span className="text-[#10b981] font-semibold">A-Pass verified</span>
                <span className="text-[#333333]">·</span>
                <span className="text-[#555555]">Tier {cviState.tier}</span>
                <span className="text-[#333333]">·</span>
                <span className="text-[#444444]">expires {new Date(cviState.expirationTime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                {cviState.countries.length > 0 && (
                  <>
                    <span className="text-[#333333]">·</span>
                    <span className="text-[#444444] truncate hidden sm:block">
                      {cviState.countries.slice(0, 3).join(', ')}
                      {cviState.countries.length > 3 && ` +${cviState.countries.length - 3}`}
                    </span>
                  </>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    cviState.source === 'cleanverse'
                      ? 'border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]'
                      : cviState.source === 'mock-cvi-onchain'
                        ? 'border-[#836EF9]/30 bg-[#836EF9]/10 text-[#836EF9]'
                        : 'border-[#1f1f1f] bg-[#111111] text-[#444444]'
                  }`}>
                    {cviState.source === 'cleanverse'
                      ? '✓ query_apass'
                      : cviState.source === 'mock-cvi-onchain'
                        ? '✓ MockCVI'
                        : 'local'}
                  </span>
                  <span className="flex items-center gap-1 text-[#10b981]/50">
                    <span className="w-1 h-1 rounded-full bg-[#10b981]" />
                    mint · settle · travel_rule
                  </span>
                </span>
              </>
            )}
            {cviState.status === 'unverified' && (
              <>
                <ShieldAlert className="w-3 h-3 text-[#f59e0b]" />
                <span className="text-[#f59e0b]">KYB unverified</span>
                <span className="text-[#333333]">·</span>
                <Link href="/dashboard/mint" className="text-[#f59e0b] hover:underline underline-offset-2">
                  complete verification →
                </Link>
              </>
            )}
          </div>
        )}

        <div className="stats-grid grid-cols-4 mb-6 stagger-2">
          <div className="stat-cell">
            <div className="stat-label flex items-center gap-2">
              TVL
              <span className="w-1 h-1 rounded-full bg-[#10b981] status-pulse" />
            </div>
            <div className="stat-value tabular-nums">${tvlFormatted.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label flex items-center gap-2">
              Yield Earned
              <span className="w-1 h-1 rounded-full bg-[#10b981] status-pulse" />
            </div>
            <div className="stat-value stat-value-green tabular-nums">+${yieldFormatted.toFixed(2)}</div>
            {tvlFormatted > 0 && (
              <div className="text-[11px] text-[#10b981] mt-1">+{((yieldFormatted / tvlFormatted) * 100).toFixed(2)}%</div>
            )}
          </div>
          <div className="stat-cell">
            <div className="stat-label">Active Invoices</div>
            <div className="stat-value tabular-nums">{activeDepositsCount}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label flex items-center gap-2">
              APY Range
              <span className="w-1 h-1 rounded-full bg-[#f59e0b]" />
            </div>
            <div className="stat-value stat-value-amber tabular-nums">{conservativeAPY}-{aggressiveAPY}%</div>
            <div className="text-[10px] text-[#666666] mt-1">via Aave V3</div>
          </div>
        </div>

        <div className="terminal-card p-4 mb-8 stagger-3">
          <MiniActivityFeed />
        </div>

        <div className="border border-[#1f1f1f] rounded overflow-hidden stagger-4">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f1f] bg-[#111111]">
            <span className="text-xs font-semibold">invoices</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-xs">
                <span className="text-[#666666]">search:</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none w-24 text-[#e5e5e5]"
                  placeholder="_"
                />
                <span className="cursor-blink text-[#666666]">|</span>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block w-4 h-4 border-2 border-[#1f1f1f] border-t-[#10b981] rounded-full animate-spin mb-3" />
              <p className="text-xs text-[#666666]">loading invoices...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <div className="text-[#ef4444] text-xs mb-4">{error}</div>
              <Button variant="secondary" size="sm" onClick={fetchInvoices}>
                <RefreshCw className="w-3 h-3" />
                retry
              </Button>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="p-6">
              {/* Protocol concept — shown to first-time users and hackathon judges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div className="p-3 rounded border border-[#1f1f1f] bg-[#111111]">
                  <div className="text-[10px] text-[#10b981] font-semibold uppercase tracking-[0.15em] mb-1.5">① CVI Gating</div>
                  <div className="text-[10px] text-[#555555] leading-relaxed">KYB via Cleanverse A-Pass. Only verified wallets can mint or receive settlement.</div>
                </div>
                <div className="p-3 rounded border border-[#1f1f1f] bg-[#111111]">
                  <div className="text-[10px] text-[#10b981] font-semibold uppercase tracking-[0.15em] mb-1.5">② CVA Settlement</div>
                  <div className="text-[10px] text-[#555555] leading-relaxed">Buyers settle with Cleanverse Verified Assets. FATF Rec-16 Travel Rule enforced.</div>
                </div>
                <div className="p-3 rounded border border-[#1f1f1f] bg-[#111111]">
                  <div className="text-[10px] text-[#10b981] font-semibold uppercase tracking-[0.15em] mb-1.5">③ AI Yield</div>
                  <div className="text-[10px] text-[#555555] leading-relaxed">Agent monitors risk on Monad (10 k TPS) and auto-switches Aave V3 strategies on-chain.</div>
                </div>
              </div>
              {/* 5-minute demo path for hackathon judges */}
              <div className="mb-5 p-3 rounded border border-[#10b981]/20 bg-[#10b981]/5">
                <div className="text-[10px] text-[#10b981] font-semibold uppercase tracking-[0.15em] mb-2">5-minute demo path</div>
                <div className="space-y-1 text-[10px] text-[#555555]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#10b981] font-mono">①</span>
                    <span>Connect MetaMask → CVI badge in nav triggers <span className="text-[#888888]">query_apass</span> automatically</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#10b981] font-mono">②</span>
                    <Link href="/dashboard/mint" className="text-[#10b981] hover:underline underline-offset-2">Go to Mint →</Link>
                    <span>complete KYB · select USDC CVA A-Token · submit</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#10b981] font-mono">③</span>
                    <span>Open invoice detail → <span className="text-[#888888]">Request Payment</span> (CVA) → <span className="text-[#888888]">generate Travel Rule</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#10b981] font-mono">④</span>
                    <Link href="/dashboard/agent" className="text-[#836EF9] hover:underline underline-offset-2">Agent page →</Link>
                    <span>Cleanverse health panel · Monad 10k TPS stats · auto-execute toggle</span>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
                  <span className="text-[10px] text-[#666666] uppercase tracking-wider">AI Agent Standing By</span>
                </div>
                <Link href="/dashboard/mint">
                  <Button size="sm">
                    <Plus className="w-3 h-3" />
                    mint invoice
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <table className="terminal-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Due</th>
                  <th>Strategy</th>
                  <th>APY</th>
                  <th>Yield</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr
                    key={invoice.tokenId}
                    className="cursor-pointer"
                    onClick={() => window.location.href = `/dashboard/invoice/${invoice.tokenId}`}
                  >
                    <td className="text-[#10b981] font-semibold">{invoice.id}</td>
                    <td className="font-semibold tabular-nums">
                      <div>{invoice.amount}</div>
                      {invoiceCvaMap[invoice.tokenId] && (
                        <div className="text-[10px] text-[#10b981]/70 mt-0.5">
                          CVA: {invoiceCvaMap[invoice.tokenId]}
                        </div>
                      )}
                    </td>
                    <td className="text-[#666666]">{invoice.dueDate}</td>
                    <td>{invoice.strategy}</td>
                    <td className="tabular-nums">{invoice.apy}</td>
                    <td className="text-[#10b981] font-semibold tabular-nums">{invoice.accruedYield}</td>
                    <td>
                      <span className={`status-badge ${invoice.status === "InYield" ? "status-active" : "status-pending"}`}>
                        <span className="status-dot" />
                        {invoice.status === "InYield" ? "active" : invoice.status === "Minted" ? "pending" : invoice.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="text-right">
                      <ArrowUpRight className="w-4 h-4 text-[#666666]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {filteredInvoices.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#1f1f1f] bg-[#111111] text-[11px] text-[#666666]">
              <span>{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""} | {totalInvoices} total minted</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
                agent monitoring
              </span>
            </div>
          )}
        </div>
      </main>

      <StatusBar status="online" />
    </div>
  )
}

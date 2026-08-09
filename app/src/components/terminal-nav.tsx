"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi"
import { injected } from "wagmi/connectors"
import { useState, useEffect } from "react"
import { Shield } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import { getChainMeta } from "@/lib/contracts/addresses"
import { useCleanverseCVI } from "@/hooks/use-cleanverse-cvi"

const navItems = [
  { href: "/dashboard", label: "portfolio" },
  { href: "/dashboard/mint", label: "mint" },
  { href: "/dashboard/agent", label: "agent" },
  { href: "/dashboard/issuer", label: "issuer" },
  { href: "/dashboard/admin", label: "admin" },
]

export function TerminalNav() {
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const [mounted, setMounted] = useState(false)
  const { state: cviState } = useCleanverseCVI()

  const meta = getChainMeta(chainId)
  const chainLabel = meta?.shortName || (chainId === 31337 ? 'LOCAL' : 'EVM')

  useEffect(() => {
    setMounted(true)
  }, [])

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard"
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="sticky top-0 z-50 h-12 border-b border-[#1f1f1f] bg-[#0a0a0a] px-6 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-5 h-5 bg-[#10b981] rounded" />
          <span className="font-semibold text-sm">
            <span className="text-[#10b981]">v</span>ino
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-1.5 text-xs transition-colors rounded",
                isActive(item.href)
                  ? "text-[#e5e5e5] bg-[#1a1a1a]"
                  : "text-[#666666] hover:text-[#e5e5e5]"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />

        {/* CVI status badge — always-visible compliance indicator.
            Green = query_apass live (Cleanverse).
            Purple = MockCVI.isVerified() on-chain fallback. */}
        {mounted && isConnected && (
          cviState.status === 'verified' ? (
            cviState.source === 'mock-cvi-onchain' ? (
              <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#836EF9]/30 bg-[#836EF9]/10 text-[10px] text-[#836EF9] font-semibold uppercase tracking-wider" title="CVI via MockCVI.isVerified() on-chain">
                <Shield className="w-2.5 h-2.5" />
                ⛓ CVI T{cviState.tier}
              </span>
            ) : (
              <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 text-[10px] text-[#10b981] font-semibold uppercase tracking-wider" title="CVI via query_apass (Cleanverse)">
                <Shield className="w-2.5 h-2.5" />
                CVI T{cviState.tier}
              </span>
            )
          ) : cviState.status === 'loading' ? (
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#1f1f1f] text-[10px] text-[#444444]">
              <Shield className="w-2.5 h-2.5" />
              CVI…
            </span>
          ) : cviState.status === 'unverified' ? (
            <Link href="/dashboard/mint" className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[10px] text-[#f59e0b] font-semibold hover:bg-[#f59e0b]/20 transition-colors">
              <Shield className="w-2.5 h-2.5" />
              KYB
            </Link>
          ) : null
        )}

        {mounted && isConnected && address ? (
          <button
            onClick={() => disconnect()}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] border border-[#1f1f1f] rounded text-xs font-mono hover:border-[#10b981] transition-colors"
          >
            <span className="w-1.5 h-1.5 bg-[#10b981] rounded-full" />
            {address.slice(0, 6)}...{address.slice(-4)}
          </button>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            disabled={!mounted || isPending}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs text-[#666666] hover:text-[#e5e5e5] transition-colors disabled:opacity-50"
          >
            {isPending ? "connecting..." : "connect"}
          </button>
        )}

        {mounted && <div className="network-badge">{chainLabel}</div>}
      </div>
    </nav>
  )
}

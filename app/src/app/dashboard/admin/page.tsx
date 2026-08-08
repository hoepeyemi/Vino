"use client"

import { useState } from "react"
import Link from "next/link"
import { useAccount, useChainId, useSignMessage } from "wagmi"
import {
  ArrowLeft, Loader2, CheckCircle2, XCircle,
  ExternalLink, ShieldCheck, ShieldOff, Search, PenLine,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBar } from "@/components/ui/status-bar"
import { TerminalNav } from "@/components/terminal-nav"

const MOCK_CVI_ADDRESS = process.env.NEXT_PUBLIC_MOCK_CVI_ADDRESS ?? "0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3"
const EXPLORER = "https://testnet.monadexplorer.com"

type CheckResult  = { verified: boolean; owner: string } | null
type ActionResult = { txHash: string; action: "verify" | "revoke" } | null

function adminMessage(action: string, target: string, timestamp: number) {
  return `vino admin: ${action} ${target.toLowerCase()} at ${timestamp}`
}

const ERROR_MESSAGES: Record<string, string> = {
  relay_not_configured: "RELAY_PRIVATE_KEY is not set on the server.",
  not_owner:            "Your wallet is not the MockCVI contract owner.",
  signature_expired:    "Signature expired — please try again.",
  signature_mismatch:   "Signature mismatch. Make sure you sign with the owner wallet.",
  signature_invalid:    "Invalid signature.",
  rate_limited:         "Too many requests. Try again later.",
  rpc_error:            "Could not reach Monad Testnet RPC.",
  internal_error:       "Transaction failed. Check server logs.",
}

export default function AdminPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()

  const [walletInput, setWalletInput]   = useState("")
  const [checking, setChecking]         = useState(false)
  const [pendingAction, setPendingAction] = useState<"verify" | "revoke" | null>(null)
  const [actioning, setActioning]       = useState<"verify" | "revoke" | null>(null)
  const [checkResult, setCheckResult]   = useState<CheckResult>(null)
  const [actionResult, setActionResult] = useState<ActionResult>(null)
  const [error, setError]               = useState<string | null>(null)

  const target       = walletInput.trim()
  const isValidAddr  = /^0x[0-9a-fA-F]{40}$/.test(target)
  const isOwner      = !!checkResult && !!address &&
    checkResult.owner.toLowerCase() === address.toLowerCase()
  const busy         = checking || pendingAction !== null || actioning !== null

  async function check() {
    setError(null)
    setChecking(true)
    setCheckResult(null)
    setActionResult(null)
    try {
      const res  = await fetch("/api/admin/cvi-manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", address: target }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(ERROR_MESSAGES[data.error] ?? data.error); return }
      setCheckResult(data)
    } catch {
      setError("Network error.")
    } finally {
      setChecking(false)
    }
  }

  async function mutate(action: "verify" | "revoke") {
    if (!address) { setError("Connect your wallet first."); return }
    setError(null)
    setPendingAction(action)

    let signature: string
    const timestamp = Math.floor(Date.now() / 1000)
    const message   = adminMessage(action, target, timestamp)

    try {
      signature = await signMessageAsync({ message })
    } catch {
      setPendingAction(null)
      setError("Signature cancelled.")
      return
    }

    setPendingAction(null)
    setActioning(action)

    try {
      const res  = await fetch("/api/admin/cvi-manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, address: target, signer: address, signature, timestamp }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(ERROR_MESSAGES[data.error] ?? data.error); return }

      setActionResult({ txHash: data.txHash, action })

      // Refresh status
      const recheck = await fetch("/api/admin/cvi-manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", address: target }),
      })
      if (recheck.ok) setCheckResult(await recheck.json())
    } catch {
      setError("Network error.")
    } finally {
      setActioning(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-grid noise-overlay scan-line pb-8">
      <TerminalNav />

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/dashboard" className="text-[#666666] hover:text-[#e5e5e5] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-0.5">KYB Admin</div>
            <h1 className="text-lg font-semibold">MockCVI Manager</h1>
          </div>
        </div>

        {/* Contract info bar */}
        <div className="terminal-card p-4 mb-6 flex flex-wrap gap-6 text-xs">
          <div>
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-1">Contract</div>
            <a
              href={`${EXPLORER}/address/${MOCK_CVI_ADDRESS}`}
              target="_blank" rel="noopener noreferrer"
              className="font-mono text-[#10b981] hover:underline flex items-center gap-1"
            >
              {MOCK_CVI_ADDRESS.slice(0, 10)}…{MOCK_CVI_ADDRESS.slice(-8)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div>
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-1">Network</div>
            <span className="font-mono">Monad Testnet ({chainId})</span>
          </div>
          <div>
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-1">Connected</div>
            <span className="font-mono">
              {isConnected && address
                ? `${address.slice(0, 6)}…${address.slice(-4)}`
                : <span className="text-[#666666]">not connected</span>}
            </span>
          </div>
        </div>

        {/* Main panel */}
        <div className="terminal-card p-5 mb-4">
          <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-4">Wallet Verification</div>

          {/* Address input + check */}
          <div className="flex gap-2 mb-4">
            <Input
              value={walletInput}
              onChange={(e) => {
                setWalletInput(e.target.value)
                setCheckResult(null)
                setActionResult(null)
                setError(null)
              }}
              placeholder="0x wallet address to verify or revoke"
              className="font-mono text-sm"
            />
            <Button
              variant="secondary"
              onClick={check}
              disabled={!isValidAddr || busy}
            >
              {checking
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />}
              check
            </Button>
          </div>

          {/* Status result */}
          {checkResult && (
            <div className="mb-4 p-3 border border-[#1f1f1f] rounded bg-[#0a0a0a] space-y-1.5">
              <div className="flex items-center gap-2">
                {checkResult.verified ? (
                  <><CheckCircle2 className="w-4 h-4 text-[#10b981]" />
                  <span className="text-[#10b981] text-sm font-semibold">VERIFIED</span></>
                ) : (
                  <><XCircle className="w-4 h-4 text-[#ef4444]" />
                  <span className="text-[#ef4444] text-sm font-semibold">NOT VERIFIED</span></>
                )}
              </div>
              <div className="text-[11px] font-mono text-[#666666]">
                owner: {checkResult.owner}
                {isConnected && (
                  <span className={`ml-2 ${isOwner ? "text-[#10b981]" : "text-[#f59e0b]"}`}>
                    {isOwner ? "(you — can sign)" : "(not you — connect the owner wallet)"}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={() => mutate("verify")}
              disabled={!isValidAddr || busy || !isConnected}
              className="flex-1"
            >
              {pendingAction === "verify"
                ? <><PenLine className="w-4 h-4" /> sign in wallet…</>
                : actioning === "verify"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> submitting…</>
                : <><ShieldCheck className="w-4 h-4" /> verify wallet</>}
            </Button>
            <Button
              variant="secondary"
              onClick={() => mutate("revoke")}
              disabled={!isValidAddr || busy || !isConnected}
              className="flex-1 border-[#7f1d1d] text-[#ef4444] hover:bg-[#7f1d1d]/10"
            >
              {pendingAction === "revoke"
                ? <><PenLine className="w-4 h-4" /> sign in wallet…</>
                : actioning === "revoke"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> submitting…</>
                : <><ShieldOff className="w-4 h-4" /> revoke</>}
            </Button>
          </div>

          {!isConnected && (
            <p className="text-[11px] text-[#666666] mt-3">Connect the MockCVI owner wallet to verify or revoke.</p>
          )}
          {isConnected && checkResult && !isOwner && (
            <p className="text-[11px] text-[#f59e0b] mt-3">
              Switch to the owner wallet ({checkResult.owner.slice(0, 6)}…{checkResult.owner.slice(-4)}) to perform actions.
            </p>
          )}
          {isConnected && !checkResult && (
            <p className="text-[11px] text-[#444444] mt-3">
              Enter an address and hit <strong>check</strong> first, then sign with the owner wallet to verify or revoke.
            </p>
          )}
        </div>

        {/* Tx submitted */}
        {actionResult && (
          <div className="terminal-card p-4 mb-4">
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-2">Transaction submitted</div>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
              <span className="text-[#10b981] text-sm font-semibold">
                {actionResult.action === "verify" ? "Wallet verified" : "Verification revoked"}
              </span>
            </div>
            <a
              href={`${EXPLORER}/tx/${actionResult.txHash}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[11px] font-mono text-[#666666] hover:text-[#e5e5e5] flex items-center gap-1 mt-1"
            >
              {actionResult.txHash.slice(0, 22)}…{actionResult.txHash.slice(-8)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="terminal-card p-4 mb-4 border-[#7f1d1d]">
            <div className="text-[#ef4444] text-sm">{error}</div>
          </div>
        )}

        {/* Batch hint */}
        <div className="terminal-card p-4 text-xs text-[#444444]">
          <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-2">Batch verify</div>
          To whitelist multiple wallets at once, run the relay script directly on the server:
          <pre className="mt-2 text-[11px] text-[#666666] bg-[#111111] rounded p-2 overflow-x-auto whitespace-pre-wrap">
{`# from contracts/
node scripts/relay-kyb-approval.js <wallet1> <wallet2> …`}
          </pre>
        </div>
      </main>

      <StatusBar status="online" />
    </div>
  )
}

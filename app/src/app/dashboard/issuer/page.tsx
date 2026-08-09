"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TerminalNav } from "@/components/terminal-nav"
import { StatusBar } from "@/components/ui/status-bar"
import {
  Lock,
  Eye,
  EyeOff,
  Shield,
  UserPlus,
  Copy,
  FileText,
  AlertTriangle,
  Loader2,
  XCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
} from "lucide-react"
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useChainId,
} from "wagmi"
import { InvoiceNFTABI } from "@/lib/contracts/abis"
import { getInvoiceNFTAddress } from "@/lib/contracts/addresses"
import { isAddress, type Address } from "viem"
import { toast } from "sonner"

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoicePrivacy {
  tokenId: string
  dataCommitment: string
  status: number
  authorizedCount: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

// InvoiceStatus.Active = 0, InvoiceStatus.InYield = 1
const ACTIVE_STATUSES = new Set([0, 1])

// Gas budget for authorizeReveal.
// Breakdown: SLOAD cold (2100) + SSTORE first write (20000) + LOG2 (~1700) + overhead ≈ 80k.
// 200k is a generous safety buffer for Monad Testnet's variable gas costs.
const AUTHORIZE_GAS = 200_000n

const EXPLORER = "https://testnet.monadexplorer.com"

// ─── Component ───────────────────────────────────────────────────────────────

export default function IssuerDashboardPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const contractAddress = getInvoiceNFTAddress(chainId)
  const publicClient = usePublicClient()

  const [invoices, setInvoices] = useState<InvoicePrivacy[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Dialog state
  const [selectedInvoice, setSelectedInvoice] = useState<InvoicePrivacy | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newAddress, setNewAddress] = useState("")
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Live wallet address ref — async preflight reads this instead of the closed-over value
  const addressRef = useRef(address)
  useEffect(() => { addressRef.current = address }, [address])

  // Snapshot of what was submitted — captured at writeContract() call time so the
  // success toast is correct even if the user closes the dialog while confirming.
  const submittedRef = useRef<{ address: string; invoiceId: string } | null>(null)

  const {
    writeContract,
    reset: resetWrite,
    data: txHash,
    isPending,
    error: writeError,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
  })

  // ─── Fetch user invoices ──────────────────────────────────────────────────
  //
  // Strategy:
  //   1. Call getActiveInvoices() — one eth_call, returns all active tokenIds chain-wide
  //   2. Batch-read via getInvoice(tokenId) multicall — decoded as a named object because
  //      getInvoice returns a single unnamed tuple (viem decodes tuple components by name).
  //      NOT "invoices" (public mapping getter): its 8 top-level named outputs are decoded
  //      as an array by viem v2, making raw.issuer undefined and filtering everything out.
  //   3. Filter client-side: issuer === address && ACTIVE_STATUSES.has(status)

  const fetchUserInvoices = useCallback(async () => {
    if (!isConnected || !address || !publicClient || !contractAddress) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setFetchError(null)

    try {
      // Step 1: get all active + inYield token IDs
      const activeIds = await publicClient.readContract({
        address: contractAddress,
        abi: InvoiceNFTABI,
        functionName: "getActiveInvoices",
      }) as bigint[]

      if (!activeIds || activeIds.length === 0) {
        setInvoices([])
        return
      }

      // Step 2: batch-read invoice state for every active tokenId.
      //   - functionName: "getInvoice" — returns a single unnamed tuple with NAMED components.
      //     viem v2 decodes a single-tuple return as a named object { issuer, status, … }.
      //   - NOT "invoices" (public mapping getter): that has 8 TOP-LEVEL named outputs which
      //     viem v2 decodes as an array — raw.issuer would be undefined, filtering everything out.
      //   - allowFailure: true so one bad read doesn't kill the whole batch.
      const multicallResults = await publicClient.multicall({
        contracts: activeIds.map((id) => ({
          address: contractAddress as Address,
          abi: InvoiceNFTABI,
          functionName: "getInvoice" as const,
          args: [id] as [bigint],
        })),
        allowFailure: true,
      })

      // Step 3: filter — keep only invoices minted by the connected wallet.
      //
      // getInvoice returns a single unnamed tuple: viem decodes it as a named object
      //   { dataCommitment, amountCommitment, dueDate, createdAt, issuer, status, … }
      // Access named components directly — no positional indexing needed.
      const myInvoices: InvoicePrivacy[] = []
      for (let i = 0; i < activeIds.length; i++) {
        const result = multicallResults[i]
        if (result.status === "failure") {
          console.warn(`[issuer] getInvoice(${activeIds[i]}) multicall failure:`, result.error)
          continue
        }

        const raw = result.result as {
          dataCommitment: `0x${string}`
          amountCommitment: `0x${string}`
          dueDate: bigint
          createdAt: bigint
          issuer: `0x${string}`
          status: number
          riskScore: number
          paymentProbability: number
        }

        const issuer = raw?.issuer
        const dataCommitment = raw?.dataCommitment
        const statusVal = raw?.status

        if (!issuer || issuer === "0x0000000000000000000000000000000000000000") {
          console.warn(`[issuer] invoices(${activeIds[i]}) returned empty issuer`)
          continue
        }

        // Only include invoices where THIS wallet is the original issuer
        if (issuer.toLowerCase() !== address.toLowerCase()) continue

        // Only show active or in-yield invoices
        if (!ACTIVE_STATUSES.has(Number(statusVal))) continue

        myInvoices.push({
          tokenId: activeIds[i].toString(),
          dataCommitment,
          status: Number(statusVal),
          authorizedCount: 0,
        })
      }

      setInvoices(myInvoices)
    } catch (err) {
      console.error("[issuer] fetchUserInvoices failed:", err)
      const msg = err instanceof Error ? err.message : String(err)
      setFetchError(`Failed to load invoices: ${msg.slice(0, 200)}`)
      setInvoices([])
    } finally {
      setIsLoading(false)
    }
  }, [isConnected, address, publicClient, contractAddress])

  useEffect(() => {
    fetchUserInvoices()
  }, [fetchUserInvoices])

  // ─── Authorize handler ────────────────────────────────────────────────────

  const handleAuthorize = async () => {
    if (
      !selectedInvoice ||
      !newAddress ||
      !isAddress(newAddress) ||
      !publicClient ||
      !contractAddress
    ) return

    // Always read address from ref so we get the live value at call time,
    // not a stale value captured earlier in the React closure.
    const currentAddress = addressRef.current
    if (!currentAddress) return

    setPreflightError(null)
    setIsSubmitting(true)

    try {
      // ── Strict pre-flight: verify on-chain issuer before spending gas ──
      //
      // Use "getInvoice" (single unnamed tuple → named components object) NOT "invoices"
      // (public mapping getter with 8 top-level named outputs). Viem v2 decodes multiple
      // top-level outputs as an ARRAY, so raw.issuer would be undefined and we'd always
      // get a false "not found" error. A single tuple output decodes as a named object.
      //
      // ANY failure here BLOCKS the transaction — we never silently fall through.
      let onChainIssuer: string

      try {
        const inv = await publicClient.readContract({
          address: contractAddress,
          abi: InvoiceNFTABI,
          functionName: "getInvoice",
          args: [BigInt(selectedInvoice.tokenId)],
        }) as {
          dataCommitment: `0x${string}`
          amountCommitment: `0x${string}`
          dueDate: bigint
          createdAt: bigint
          issuer: `0x${string}`
          status: number
          riskScore: number
          paymentProbability: number
        }

        const issuerFromChain = inv?.issuer

        if (!issuerFromChain || issuerFromChain === "0x0000000000000000000000000000000000000000") {
          throw new Error(
            `Invoice #${selectedInvoice.tokenId} returned an empty issuer — ` +
            `it may not exist or the RPC is lagging.`
          )
        }
        onChainIssuer = issuerFromChain.toLowerCase()
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr)
        setPreflightError(
          `Cannot verify ownership on-chain: ${msg.slice(0, 250)}. ` +
          `Check your network connection and try again.`
        )
        return
      }

      if (onChainIssuer !== currentAddress.toLowerCase()) {
        setPreflightError(
          `Wallet mismatch — Invoice #${selectedInvoice.tokenId} was minted by ` +
          `${onChainIssuer.slice(0, 6)}…${onChainIssuer.slice(-4)}, ` +
          `but your connected wallet is ${currentAddress.slice(0, 6)}…${currentAddress.slice(-4)}. ` +
          `Switch to the wallet that originally minted this invoice.`
        )
        return
      }

      // ── Gas estimation ──────────────────────────────────────────────────────
      // Try official RPC estimation first (adds +30% safety buffer).
      // Fall back to hardcoded constant if estimation fails — this is expected on
      // Monad Testnet's thirdweb RPC which doesn't fully support eth_estimateGas.
      // Providing explicit gas also bypasses MetaMask's own pre-send simulation on
      // broken RPC nodes (which ignores `from`, sees msg.sender=0x0, and falsely
      // predicts a revert).
      let gasLimit = AUTHORIZE_GAS
      try {
        const est = await publicClient.estimateContractGas({
          address: contractAddress,
          abi: InvoiceNFTABI,
          functionName: "authorizeReveal",
          args: [BigInt(selectedInvoice.tokenId), newAddress as Address],
          account: currentAddress as Address,
        })
        gasLimit = (est * 130n) / 100n
      } catch {
        // Estimation failed — use the safe hardcoded constant
      }

      // Snapshot submitted values before writeContract so the success toast stays
      // accurate even if the user closes the dialog while the tx is confirming.
      submittedRef.current = {
        address: newAddress,
        invoiceId: selectedInvoice.tokenId,
      }

      // ── Broadcast ────────────────────────────────────────────────────────────
      // No simulateContract: Monad Testnet RPC ignores `from` in eth_call,
      // so simulation always sees msg.sender=address(0) and reverts even for
      // legitimate callers. The strict pre-flight above is our correctness gate.
      writeContract({
        address: contractAddress,
        abi: InvoiceNFTABI,
        functionName: "authorizeReveal",
        args: [BigInt(selectedInvoice.tokenId), newAddress as Address],
        gas: gasLimit,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Post-success ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isSuccess || !txHash) return

    // Use the ref snapshot — immune to dialog close clearing newAddress/selectedInvoice
    const submitted = submittedRef.current
    const invoiceId = submitted?.invoiceId
    const authorizedAddr = submitted?.address ?? ""

    toast.success("Address authorized", {
      description: authorizedAddr
        ? `${authorizedAddr.slice(0, 6)}…${authorizedAddr.slice(-4)} can now verify Invoice #${invoiceId}`
        : `Invoice #${invoiceId} authorization confirmed`,
      action: {
        label: "View tx",
        onClick: () =>
          window.open(`${EXPLORER}/tx/${txHash}`, "_blank", "noopener,noreferrer"),
      },
    })

    setDialogOpen(false)
    setNewAddress("")
    setPreflightError(null)

    // Optimistic update — increment authorized count
    if (invoiceId) {
      setInvoices((prev) =>
        prev.map((inv) =>
          inv.tokenId === invoiceId
            ? { ...inv, authorizedCount: inv.authorizedCount + 1 }
            : inv
        )
      )
    }
  }, [isSuccess, txHash])

  // ─── Dialog helpers ───────────────────────────────────────────────────────

  const openDialog = (invoice: InvoicePrivacy) => {
    resetWrite()
    setSelectedInvoice(invoice)
    setNewAddress("")
    setPreflightError(null)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setPreflightError(null)
    setNewAddress("")
  }

  const copyCommitment = (commitment: string, tokenId: string) => {
    navigator.clipboard.writeText(commitment)
    setCopiedId(tokenId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // ─── Error classification ─────────────────────────────────────────────────

  // A MetaMask simulation warning occurs when the node ignores `from` in eth_call
  // and wrongly predicts a revert. The tx WILL succeed if the pre-flight passed.
  // Detect MetaMask's pre-send simulation failure on Monad Testnet's broken RPC.
  // writeError is a PRE-SUBMIT error (wallet rejected / simulated revert) — distinct
  // from receiptError which is a POST-SUBMIT on-chain revert.
  // We check message content because wagmi surfaces the underlying provider error text.
  const isMetaMaskSimWarning =
    !!writeError &&
    !preflightError &&
    (writeError.message?.includes("Not token owner") ||
      writeError.message?.includes("execution reverted") ||
      writeError.message?.includes("EstimateGasExecutionError"))

  // Covers MetaMask ("User rejected the request"), WalletConnect ("user rejected"),
  // Coinbase Wallet ("User denied"), and wagmi's own UserRejectedRequestError.
  const isUserRejected =
    !!writeError &&
    (writeError.message?.toLowerCase().includes("user rejected") ||
      writeError.message?.toLowerCase().includes("user denied") ||
      writeError.message?.toLowerCase().includes("rejected the request"))

  // On-chain revert after the tx was mined (e.g. state changed post-preflight)
  // Shown via its own dedicated banner — NOT routed through displayError to avoid duplication.
  const isOnChainRevert = !!receiptError

  // displayError covers: pre-flight failures + unexpected write errors.
  // isOnChainRevert, isMetaMaskSimWarning, and isUserRejected each have dedicated banners.
  const displayError =
    preflightError ??
    (writeError && !isMetaMaskSimWarning && !isUserRejected
      ? writeError.message?.slice(0, 300)
      : null)

  const isBusy = isSubmitting || isPending || isConfirming

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-grid noise-overlay scan-line pb-8">
      <TerminalNav />

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-[24px] font-bold mb-1 flex items-center gap-3">
              <Shield className="w-5 h-5 text-[#10b981]" />
              PRIVACY CONTROLS
            </h1>
            <p className="text-[12px] text-[#666666]">
              Manage selective disclosure for your invoices
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded border border-[#10b981]/30 bg-[#10b981]/10 text-[10px] text-[#10b981] font-semibold uppercase tracking-wider">
              <Lock className="w-3 h-3" />
              {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} protected
            </span>
            {isConnected && !isLoading && (
              <button
                className="text-[11px] text-[#666666] hover:text-[#e5e5e5] flex items-center gap-1.5 transition-colors"
                onClick={fetchUserInvoices}
              >
                <RefreshCw className="w-3 h-3" />
                refresh
              </button>
            )}
          </div>
        </div>

        {/* Privacy explainer */}
        <div className="terminal-card p-4 mb-6">
          <div className="flex items-start gap-4">
            <Lock className="w-4 h-4 text-[#10b981] mt-0.5 shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#d6d6d6] mb-1">Your data stays private</p>
              <p className="text-[11px] text-[#666666] mb-3">
                Invoice details are stored as keccak256 commitment hashes on-chain.
                Only you — as the CVI-verified issuer — can authorize specific parties to verify the underlying data.
              </p>
              <div className="flex flex-wrap gap-4 text-[10px]">
                <span className="flex items-center gap-1.5 text-[#666666]"><EyeOff className="w-3 h-3" /> client names hidden</span>
                <span className="flex items-center gap-1.5 text-[#666666]"><EyeOff className="w-3 h-3" /> amounts hidden</span>
                <span className="flex items-center gap-1.5 text-[#10b981]"><Eye className="w-3 h-3" /> selectively revealable</span>
              </div>
            </div>
          </div>
        </div>

        {/* CVI Protocol Rail — issuer context */}
        <div className="border border-[#1a1a1a] rounded p-3 mb-6 bg-[#0d0d0d]">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">CVI Protocol Flow</span>
            <span className="text-[9px] text-[#333333]">· Cleanverse Verified Identity</span>
          </div>
          <div className="flex items-center gap-1 text-[9px] font-mono flex-wrap">
            <span className="px-1.5 py-0.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]">A-Pass KYB</span>
            <span className="text-[#333333]">→</span>
            <span className="px-1.5 py-0.5 rounded border border-[#1f1f1f] text-[#555555]">generate_apass</span>
            <span className="text-[#333333]">→</span>
            <span className="px-1.5 py-0.5 rounded border border-[#1f1f1f] text-[#555555]">query_apass</span>
            <span className="text-[#333333]">→</span>
            <span className="px-1.5 py-0.5 rounded border border-[#836EF9]/30 bg-[#836EF9]/10 text-[#836EF9]">MockCVI.verify()</span>
            <span className="text-[#333333]">→</span>
            <span className="px-1.5 py-0.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]">invoice mint</span>
            <span className="text-[#333333]">→</span>
            <span className="px-1.5 py-0.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]">selective disclosure</span>
          </div>
        </div>

        {/* Loading */}
        {isConnected && isLoading && (
          <div className="terminal-card p-12 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-[#10b981]" />
            <p className="text-[12px] text-[#666666]">Loading your invoices…</p>
          </div>
        )}

        {/* Fetch error */}
        {isConnected && !isLoading && fetchError && (
          <div className="terminal-card p-6">
            <div className="flex items-start gap-3 text-[#ef4444]">
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-medium mb-1">Failed to load invoices</p>
                <p className="text-[11px] text-[#666666]">{fetchError}</p>
                <button
                  className="mt-3 text-[11px] text-[#666666] hover:text-[#e5e5e5] flex items-center gap-1.5"
                  onClick={fetchUserInvoices}
                >
                  <RefreshCw className="w-3 h-3" />
                  try again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Not connected */}
        {!isConnected && (
          <div className="terminal-card p-12 text-center">
            <Lock className="w-8 h-8 text-[#444444] mx-auto mb-3" />
            <h3 className="text-[14px] font-semibold mb-1">Connect Your Wallet</h3>
            <p className="text-[12px] text-[#666666]">Connect the wallet you used to mint your invoices</p>
          </div>
        )}

        {/* No invoices */}
        {isConnected && !isLoading && !fetchError && invoices.length === 0 && (
          <div className="terminal-card p-12 text-center">
            <FileText className="w-8 h-8 text-[#444444] mx-auto mb-3" />
            <h3 className="text-[14px] font-semibold mb-1">No Invoices Found</h3>
            <p className="text-[12px] text-[#666666] mb-1">No active invoices minted by this wallet.</p>
            <p className="text-[11px] text-[#444444] mb-4">{address?.slice(0, 6)}…{address?.slice(-4)}</p>
            <a href="/dashboard/mint" className="text-[11px] text-[#10b981] hover:underline">mint invoice →</a>
          </div>
        )}

        {/* Invoices table */}
        {isConnected && !isLoading && !fetchError && invoices.length > 0 && (
          <div className="border border-[#1f1f1f] rounded overflow-hidden mb-6">
            <Table>
              <TableHeader>
                <TableRow className="border-[#1f1f1f] bg-[#111111] hover:bg-[#111111]">
                  <TableHead className="text-[10px] text-[#666666] uppercase tracking-wider font-semibold">Invoice</TableHead>
                  <TableHead className="text-[10px] text-[#666666] uppercase tracking-wider font-semibold">Commitment Hash</TableHead>
                  <TableHead className="text-[10px] text-[#666666] uppercase tracking-wider font-semibold">Status</TableHead>
                  <TableHead className="text-[10px] text-[#666666] uppercase tracking-wider font-semibold">Authorized</TableHead>
                  <TableHead className="text-[10px] text-[#666666] uppercase tracking-wider font-semibold text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.tokenId} className="border-[#1f1f1f] hover:bg-[#111111]">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-[#10b981]" />
                        <div>
                          <span className="text-[12px] font-semibold text-[#10b981]">#{invoice.tokenId}</span>
                          <div className="text-[10px] text-[#666666]">{invoice.status === 1 ? "in yield" : "active"}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] text-[#666666] font-mono">
                          {invoice.dataCommitment
                            ? `${invoice.dataCommitment.slice(0, 10)}…${invoice.dataCommitment.slice(-8)}`
                            : "—"}
                        </code>
                        <button
                          className="text-[#444444] hover:text-[#10b981] transition-colors"
                          disabled={!invoice.dataCommitment}
                          onClick={() => copyCommitment(invoice.dataCommitment, invoice.tokenId)}
                        >
                          {copiedId === invoice.tokenId ? (
                            <CheckCircle2 className="w-3 h-3 text-[#10b981]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#10b981] border border-[#10b981]/20 bg-[#10b981]/10 px-2 py-0.5 rounded">
                        <Lock className="w-2.5 h-2.5" />
                        private
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-[#666666]">
                        {invoice.authorizedCount} address{invoice.authorizedCount !== 1 ? "es" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        className="text-[11px] text-[#666666] hover:text-[#10b981] flex items-center gap-1.5 ml-auto transition-colors"
                        onClick={() => openDialog(invoice)}
                      >
                        <UserPlus className="w-3 h-3" />
                        authorize
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="terminal-card p-4">
            <h3 className="text-[12px] font-semibold mb-2 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#10b981]" />
              How Commitments Work
            </h3>
            <p className="text-[11px] text-[#666666] leading-relaxed">
              Invoice details are hashed into a keccak256 commitment at mint time.
              The hash is stored on-chain as proof; the original data stays with you.
              Authorized parties call <code className="text-[#10b981]">verifyReveal()</code> to confirm authenticity.
            </p>
          </div>
          <div className="terminal-card p-4">
            <h3 className="text-[12px] font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b]" />
              Important
            </h3>
            <p className="text-[11px] text-[#666666] leading-relaxed">
              Only the wallet that <strong className="text-[#d6d6d6]">originally minted</strong> the invoice can
              authorize reveals. Authorizations are on-chain and permanent.
              The issuer must be CVI-verified (Cleanverse A-Pass) to have minted at all.
            </p>
          </div>
        </div>
      </main>

      {/* Authorize Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className="bg-[#111111] border-[#1f1f1f] text-[#e5e5e5]">
          <DialogHeader>
            <DialogTitle className="text-[#e5e5e5] text-[14px] font-semibold">
              Authorize Address
            </DialogTitle>
            <DialogDescription className="text-[#666666] text-[11px]">
              Grant an address permission to verify Invoice #{selectedInvoice?.tokenId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-[11px] text-[#666666] uppercase tracking-wider mb-1.5 block">
                wallet address
              </label>
              <Input
                placeholder="0x…"
                value={newAddress}
                onChange={(e) => {
                  setNewAddress(e.target.value)
                  setPreflightError(null)
                }}
                className="font-mono text-[12px] bg-[#0a0a0a] border-[#1f1f1f] text-[#e5e5e5]"
                disabled={isBusy}
              />
              {newAddress && !isAddress(newAddress) && (
                <p className="text-[11px] text-[#ef4444] mt-1">Invalid Ethereum address</p>
              )}
            </div>

            {/* Hard error */}
            {displayError && (
              <div className="flex items-start gap-2 p-3 rounded border border-[#ef4444]/30 bg-[#ef4444]/10">
                <XCircle className="w-3.5 h-3.5 text-[#ef4444] shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#ef4444]">{displayError}</p>
              </div>
            )}

            {/* MetaMask sim warning */}
            {isMetaMaskSimWarning && (
              <div className="flex items-start gap-2 p-3 rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10">
                <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b] shrink-0 mt-0.5" />
                <div className="text-[11px] text-[#f59e0b] space-y-1">
                  <p className="font-semibold">MetaMask simulation warning</p>
                  <p>Monad Testnet RPC ignores <code>from</code> in eth_call. Ownership <strong>verified on-chain</strong>. Click Authorize again → accept risk.</p>
                </div>
              </div>
            )}

            {/* User rejected */}
            {isUserRejected && (
              <div className="flex items-start gap-2 p-3 rounded border border-[#1f1f1f] bg-[#0a0a0a]">
                <XCircle className="w-3.5 h-3.5 text-[#666666] shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#666666]">Transaction rejected. Click Authorize to try again.</p>
              </div>
            )}

            {/* On-chain revert */}
            {isOnChainRevert && (
              <div className="flex items-start gap-2 p-3 rounded border border-[#ef4444]/30 bg-[#ef4444]/10">
                <XCircle className="w-3.5 h-3.5 text-[#ef4444] shrink-0 mt-0.5" />
                <div className="text-[11px] text-[#ef4444] space-y-1">
                  <p className="font-semibold">Transaction reverted on-chain</p>
                  <p>Invoice state may have changed. Refresh and retry.</p>
                  {txHash && (
                    <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 underline opacity-70">
                      View failed tx <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Pending */}
            {isPending && (
              <div className="flex items-center gap-2 p-3 rounded border border-[#10b981]/30 bg-[#10b981]/10">
                <Loader2 className="w-3.5 h-3.5 text-[#10b981] animate-spin shrink-0" />
                <p className="text-[11px] text-[#10b981]">Confirm in your wallet…</p>
              </div>
            )}

            {/* Confirming */}
            {isConfirming && (
              <div className="flex items-center gap-2 p-3 rounded border border-[#10b981]/30 bg-[#10b981]/10">
                <Loader2 className="w-3.5 h-3.5 text-[#10b981] animate-spin shrink-0" />
                <div className="text-[11px] text-[#10b981] space-y-0.5">
                  <p>Waiting for confirmation on Monad…</p>
                  {txHash && (
                    <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 underline opacity-70">
                      View on explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Success */}
            {isSuccess && (
              <div className="flex items-center gap-2 p-3 rounded border border-[#10b981]/30 bg-[#10b981]/10">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
                <div className="text-[11px] text-[#10b981] space-y-0.5">
                  <p className="font-semibold">Address authorized on-chain</p>
                  {txHash && (
                    <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 underline opacity-70">
                      View on Monad Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="p-3 rounded border border-[#1f1f1f] bg-[#0a0a0a] text-[11px] text-[#666666]">
              <p className="font-semibold text-[#d6d6d6] mb-1">What this does:</p>
              <p>The authorized address can call <code className="text-[#10b981]">verifyReveal()</code> on Monad Testnet to confirm your invoice data is authentic. Recorded on-chain permanently.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog} disabled={isSubmitting || isPending}>
              {isSuccess ? "Close" : "Cancel"}
            </Button>
            {!isSuccess && (
              <Button onClick={handleAuthorize} disabled={!newAddress || !isAddress(newAddress) || isBusy}>
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isSubmitting ? "Verifying…" : isPending ? "Confirm in wallet…" : "Confirming…"}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    authorize
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StatusBar network="Monad Testnet" />
    </div>
  )
}

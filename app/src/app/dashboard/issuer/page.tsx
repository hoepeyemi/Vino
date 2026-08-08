"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  Check,
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

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              Privacy Controls
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage who can access your invoice details
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              <Lock className="w-3 h-3 mr-2" />
              {invoices.length} Invoice{invoices.length !== 1 ? "s" : ""} Protected
            </Badge>
            {isConnected && !isLoading && (
              <Button
                variant="outline"
                size="sm"
                className="border-glass-border"
                onClick={fetchUserInvoices}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Refresh
              </Button>
            )}
          </div>
        </div>

        {/* Privacy explainer */}
        <Card className="glass border-glass-border p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center flex-shrink-0">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold mb-2">Your Data Stays Private</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Invoice details are stored as cryptographic commitment hashes on-chain.
                Only you — as the original issuer — can authorize specific parties to
                verify the underlying data.
              </p>
              <div className="flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <EyeOff className="w-4 h-4" />
                  <span>Client names hidden</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <EyeOff className="w-4 h-4" />
                  <span>Amounts hidden</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <EyeOff className="w-4 h-4" />
                  <span>Terms hidden</span>
                </div>
                <div className="flex items-center gap-2 text-success">
                  <Eye className="w-4 h-4" />
                  <span>Selectively revealable</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Loading */}
        {isConnected && isLoading && (
          <Card className="glass border-glass-border p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading your invoices…</p>
          </Card>
        )}

        {/* Fetch error */}
        {isConnected && !isLoading && fetchError && (
          <Card className="glass border-glass-border p-8">
            <div className="flex items-start gap-3 text-destructive">
              <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">Failed to load invoices</p>
                <p className="text-sm text-muted-foreground">{fetchError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 border-glass-border"
                  onClick={fetchUserInvoices}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Try again
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Not connected */}
        {!isConnected && (
          <Card className="glass border-glass-border p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
            <p className="text-muted-foreground">
              Connect the wallet you used to mint your invoices
            </p>
          </Card>
        )}

        {/* No invoices */}
        {isConnected && !isLoading && !fetchError && invoices.length === 0 && (
          <Card className="glass border-glass-border p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No Invoices Found</h3>
            <p className="text-muted-foreground mb-2">
              No active invoices were minted by this wallet.
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              Connected: {address?.slice(0, 6)}…{address?.slice(-4)}
            </p>
            <Button asChild className="bg-gradient-to-r from-primary to-accent">
              <a href="/dashboard/mint">Mint Invoice</a>
            </Button>
          </Card>
        )}

        {/* Invoices table */}
        {isConnected && !isLoading && !fetchError && invoices.length > 0 && (
          <Card className="glass border-glass-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-glass-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Invoice</TableHead>
                  <TableHead className="text-muted-foreground">Commitment Hash</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Authorized Parties</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow
                    key={invoice.tokenId}
                    className="border-glass-border hover:bg-muted/30"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <span className="font-medium">#{invoice.tokenId}</span>
                          <div className="text-[10px] text-muted-foreground">
                            {invoice.status === 1 ? "In Yield" : "Active"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-muted-foreground font-mono">
                          {invoice.dataCommitment
                            ? `${invoice.dataCommitment.slice(0, 10)}…${invoice.dataCommitment.slice(-8)}`
                            : "—"}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          disabled={!invoice.dataCommitment}
                          onClick={() =>
                            copyCommitment(invoice.dataCommitment, invoice.tokenId)
                          }
                        >
                          {copiedId === invoice.tokenId ? (
                            <Check className="w-3 h-3 text-success" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-success/30 bg-success/10 text-success"
                      >
                        <Lock className="w-3 h-3 mr-1" />
                        Private
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {invoice.authorizedCount} address
                        {invoice.authorizedCount !== 1 ? "es" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-glass-border"
                        onClick={() => openDialog(invoice)}
                      >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Authorize
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <Card className="glass border-glass-border p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              How Commitments Work
            </h3>
            <p className="text-sm text-muted-foreground">
              When you mint an invoice, the details are hashed into a commitment. The
              hash is stored on-chain, but the original data stays with you. To verify
              an invoice, you provide the original data and a salt — if the hash
              matches, the data is authentic.
            </p>
          </Card>
          <Card className="glass border-glass-border p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Important
            </h3>
            <p className="text-sm text-muted-foreground">
              Only the wallet that <strong>originally minted</strong> the invoice can
              authorize reveals. Keep your salt secure — anyone with the salt and
              original data can prove the commitment. Authorizations are on-chain and
              permanent.
            </p>
          </Card>
        </div>
      </main>

      {/* Authorize Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className="glass border-glass-border">
          <DialogHeader>
            <DialogTitle>Authorize Address</DialogTitle>
            <DialogDescription>
              Grant an address permission to verify Invoice #
              {selectedInvoice?.tokenId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Ethereum Address
              </label>
              <Input
                placeholder="0x…"
                value={newAddress}
                onChange={(e) => {
                  setNewAddress(e.target.value)
                  setPreflightError(null)
                }}
                className="font-mono"
                disabled={isBusy}
              />
              {newAddress && !isAddress(newAddress) && (
                <p className="text-xs text-destructive mt-1">
                  Invalid Ethereum address
                </p>
              )}
            </div>

            {/* Hard error (pre-flight failure or non-simulation write error) */}
            {displayError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{displayError}</p>
              </div>
            )}

            {/* MetaMask RPC simulation warning */}
            {isMetaMaskSimWarning && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-xs text-warning space-y-1">
                  <p className="font-medium">MetaMask shows a simulation warning</p>
                  <p>
                    Monad Testnet&apos;s RPC doesn&apos;t support simulation
                    correctly. Your wallet ownership{" "}
                    <strong>has been verified on-chain</strong>. Click{" "}
                    <strong>Authorize</strong> again and if MetaMask shows
                    &quot;transaction may fail&quot;, choose{" "}
                    <strong>I accept the risk</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* User rejected */}
            {isUserRejected && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted border border-glass-border">
                <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Transaction was rejected. Click Authorize to try again.
                </p>
              </div>
            )}

            {/* On-chain revert (tx mined but contract rejected it) */}
            {isOnChainRevert && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-xs text-destructive space-y-1">
                  <p className="font-medium">Transaction reverted on-chain</p>
                  <p>
                    The contract rejected the transaction after it was mined. This
                    can happen if the invoice state changed between verification
                    and execution. Please refresh and try again.
                  </p>
                  {txHash && (
                    <a
                      href={`${EXPLORER}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 underline opacity-80"
                    >
                      View failed tx <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Pending wallet signature */}
            {isPending && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                <p className="text-xs text-primary">Confirm in your wallet…</p>
              </div>
            )}

            {/* Waiting for confirmation */}
            {isConfirming && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                <div className="text-xs text-primary space-y-0.5">
                  <p>Waiting for on-chain confirmation…</p>
                  {txHash && (
                    <a
                      href={`${EXPLORER}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 underline opacity-80"
                    >
                      View on Monad Explorer{" "}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Success */}
            {isSuccess && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/30">
                <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                <div className="text-xs text-success space-y-0.5">
                  <p className="font-medium">Address authorized successfully</p>
                  {txHash && (
                    <a
                      href={`${EXPLORER}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 underline opacity-80"
                    >
                      View on Monad Explorer{" "}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">What this does:</p>
              <p>
                The authorized address can call{" "}
                <code>verifyReveal()</code> on-chain to confirm your invoice data is
                authentic. This is recorded permanently on Monad Testnet.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={isSubmitting || isPending}
            >
              {isSuccess ? "Close" : "Cancel"}
            </Button>
            {!isSuccess && (
              <Button
                onClick={handleAuthorize}
                disabled={!newAddress || !isAddress(newAddress) || isBusy}
                className="bg-gradient-to-r from-primary to-accent"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isSubmitting
                      ? "Verifying…"
                      : isPending
                      ? "Confirm in wallet…"
                      : "Confirming…"}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Authorize
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

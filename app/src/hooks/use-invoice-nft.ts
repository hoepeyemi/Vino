"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId, usePublicClient, useSwitchChain } from "wagmi"
import { InvoiceNFTABI, type Invoice, InvoiceStatus } from "@/lib/contracts/abis"
import { getInvoiceNFTAddress } from "@/lib/contracts/addresses"
import { keccak256, encodePacked, toHex, decodeEventLog, createPublicClient, http } from "viem"
import { getMonadTestnetRpcUrls } from "@/lib/monad-rpc"

type MintLogLevel = "info" | "success" | "warning" | "error"

type MintLogEntry = {
  id: number
  time: string
  level: MintLogLevel
  message: string
}

export function useInvoiceNFT() {
  const chainId = useChainId()
  const { address } = useAccount()
  const contractAddress = getInvoiceNFTAddress(chainId)

  // Get total number of invoices
  const {
    data: totalInvoices,
    isLoading: isLoadingTotal,
    refetch: refetchTotal,
  } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "totalInvoices",
  })

  // Get user's invoice balance
  const {
    data: userBalance,
    isLoading: isLoadingBalance,
    refetch: refetchBalance,
  } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  // Get active invoices
  const {
    data: activeInvoices,
    isLoading: isLoadingActive,
    refetch: refetchActive,
  } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "getActiveInvoices",
  })

  return {
    contractAddress,
    totalInvoices: totalInvoices ? Number(totalInvoices) : 0,
    userBalance: userBalance ? Number(userBalance) : 0,
    activeInvoices: activeInvoices || [],
    isLoading: isLoadingTotal || isLoadingBalance || isLoadingActive,
    refetch: () => {
      refetchTotal()
      refetchBalance()
      refetchActive()
    },
  }
}

export function useInvoice(tokenId: bigint | number | undefined) {
  const chainId = useChainId()
  const contractAddress = getInvoiceNFTAddress(chainId)

  const {
    data: invoice,
    isLoading,
    error,
    refetch,
  } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "getInvoice",
    args: tokenId !== undefined ? [BigInt(tokenId)] : undefined,
    query: { enabled: tokenId !== undefined },
  })

  const { data: daysUntilDue } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "getDaysUntilDue",
    args: tokenId !== undefined ? [BigInt(tokenId)] : undefined,
    query: { enabled: tokenId !== undefined },
  })

  const { data: owner } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "ownerOf",
    args: tokenId !== undefined ? [BigInt(tokenId)] : undefined,
    query: { enabled: tokenId !== undefined },
  })

  // Format invoice data
  const formattedInvoice = invoice
    ? {
        dataCommitment: invoice.dataCommitment,
        amountCommitment: invoice.amountCommitment,
        dueDate: new Date(Number(invoice.dueDate) * 1000),
        createdAt: new Date(Number(invoice.createdAt) * 1000),
        issuer: invoice.issuer,
        status: invoice.status as InvoiceStatus,
        statusLabel: getStatusLabel(invoice.status as InvoiceStatus),
        riskScore: invoice.riskScore,
        paymentProbability: invoice.paymentProbability,
        owner,
        daysUntilDue: daysUntilDue ? Number(daysUntilDue) : 0,
      }
    : null

  return {
    invoice: formattedInvoice,
    isLoading,
    error,
    refetch,
  }
}

export function useMintInvoice() {
  const chainId = useChainId()
  const { address } = useAccount()
  const contractAddress = getInvoiceNFTAddress(chainId)
  const publicClient = usePublicClient()
  const { switchChainAsync } = useSwitchChain()
  const [confirmationTimedOut, setConfirmationTimedOut] = useState(false)
  const [confirmationStartedAt, setConfirmationStartedAt] = useState<number | null>(null)
  const [mintLogs, setMintLogs] = useState<MintLogEntry[]>([])
  const [forcedReceipt, setForcedReceipt] = useState<any | null>(null)
  const [isForceChecking, setIsForceChecking] = useState(false)
  const lastPendingRef = useRef(false)
  const lastConfirmingRef = useRef(false)
  const lastSuccessRef = useRef(false)
  const lastErrorRef = useRef<string | null>(null)
  const lastHashRef = useRef<string | null>(null)
  const lastForceCheckHashRef = useRef<string | null>(null)

  const { writeContractAsync, writeContract, data: hash, isPending, error } = useWriteContract()

  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({
    hash,
    confirmations: 1,
    pollingInterval: 3_000, // poll every 3s — overrides the 12s global for mint confirmation
  })

  const resolvedReceipt = receipt ?? forcedReceipt
  const resolvedIsSuccess = isSuccess || Boolean(forcedReceipt)

  const appendMintLog = useCallback((level: MintLogLevel, message: string) => {
    const entry: MintLogEntry = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      time: new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      level,
      message,
    }

    setMintLogs((prev) => [...prev.slice(-11), entry])

    const prefix = `[mint:${level}]`
    if (level === "error") {
      console.error(prefix, message)
    } else if (level === "warning") {
      console.warn(prefix, message)
    } else {
      console.log(prefix, message)
    }
  }, [])

  useEffect(() => {
    if (hash) {
      setConfirmationStartedAt(Date.now())
      setConfirmationTimedOut(false)
      setForcedReceipt(null)
      if (lastHashRef.current !== hash) {
        appendMintLog("info", `tx submitted: ${hash}`)
        lastHashRef.current = hash
      }
      return
    }

    setConfirmationStartedAt(null)
    setConfirmationTimedOut(false)
    setForcedReceipt(null)
    lastHashRef.current = null
    lastForceCheckHashRef.current = null
  }, [hash])

  useEffect(() => {
    if (isPending && !lastPendingRef.current) {
      appendMintLog("info", "wallet signature requested")
      lastPendingRef.current = true
    }

    if (!isPending) {
      lastPendingRef.current = false
    }
  }, [isPending])

  useEffect(() => {
    if (isConfirming && !lastConfirmingRef.current) {
      appendMintLog("info", "waiting for blockchain confirmation")
      lastConfirmingRef.current = true
    }

    if (!isConfirming) {
      lastConfirmingRef.current = false
    }
  }, [isConfirming])

  useEffect(() => {
    if (confirmationTimedOut) {
      appendMintLog("warning", "transaction still pending after 3 min — use 'force settle' to check manually")
    }
  }, [confirmationTimedOut])

  const forceSettle = useCallback(async () => {
    if (!hash || !publicClient || isForceChecking) {
      return false
    }

    setIsForceChecking(true)

    try {
      appendMintLog("info", "checking chain for mined receipt")
      // The fallback transport only switches on network errors, not on null
      // receipts. Query each RPC independently so a stale node can't hide a
      // receipt that another node already has.
      const rpcUrls = getMonadTestnetRpcUrls()
      for (let attempt = 1; attempt <= 3; attempt++) {
        for (const url of rpcUrls) {
          try {
            const client = createPublicClient({ transport: http(url) })
            const onChainReceipt = await client.getTransactionReceipt({
              hash: hash as `0x${string}`,
            })
            if (onChainReceipt) {
              setForcedReceipt(onChainReceipt)
              appendMintLog("success", `receipt found via ${url.replace("https://", "")}`)
              return true
            }
          } catch {
            // This RPC errored — try the next one
          }
        }
        if (attempt < 3) {
          appendMintLog("info", `tx not indexed yet, retrying (${attempt}/3)...`)
          await new Promise(r => setTimeout(r, 5_000))
        }
      }
      appendMintLog("warning", "transaction not mined yet — check explorer or try again")
      return false
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendMintLog("warning", `chain check failed: ${message}`)
      return false
    } finally {
      setIsForceChecking(false)
    }
  }, [hash, publicClient, isForceChecking, appendMintLog])

  useEffect(() => {
    if (!confirmationTimedOut || resolvedIsSuccess || !hash) {
      return
    }

    if (lastForceCheckHashRef.current === hash) {
      return
    }

    lastForceCheckHashRef.current = hash
    void forceSettle()
  }, [confirmationTimedOut, resolvedIsSuccess, hash, forceSettle])

  useEffect(() => {
    const message = error instanceof Error ? error.message : error ? String(error) : null
    if (message && message !== lastErrorRef.current) {
      appendMintLog("error", message)
      lastErrorRef.current = message
    }

    if (!message) {
      lastErrorRef.current = null
    }
  }, [error])

  useEffect(() => {
    if (!confirmationStartedAt || isSuccess || !isConfirming) {
      return
    }

    const timeoutId = setTimeout(() => {
      setConfirmationTimedOut(true)
    }, 3 * 60_000) // 3 min — Monad Testnet can be slow

    return () => clearTimeout(timeoutId)
  }, [confirmationStartedAt, isConfirming, isSuccess])

  // Extract token ID from transaction logs
  const mintedTokenId = resolvedReceipt?.logs
    ? (() => {
        try {
          for (const log of resolvedReceipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: InvoiceNFTABI,
                data: log.data,
                topics: log.topics,
              })
              if (decoded.eventName === "InvoiceMinted" && decoded.args) {
                return (decoded.args as { tokenId: bigint }).tokenId.toString()
              }
            } catch {
              // Not the event we're looking for
            }
          }
        } catch {
          // Parsing failed
        }
        return null
      })()
    : null

  useEffect(() => {
    if (resolvedIsSuccess && !lastSuccessRef.current) {
      appendMintLog("success", `transaction confirmed on-chain${mintedTokenId ? `, token #${mintedTokenId}` : ""}`)
      lastSuccessRef.current = true
    }

    if (!resolvedIsSuccess) {
      lastSuccessRef.current = false
    }
  }, [resolvedIsSuccess, mintedTokenId, appendMintLog])

  const mint = async (params: {
    invoiceData: string
    amount: string
    dueDate: Date
    salt?: `0x${string}`
  }) => {
    setMintLogs([])
    appendMintLog("info", "building invoice commitments")

    // Generate salt if not provided
    const salt = params.salt || (toHex(crypto.getRandomValues(new Uint8Array(32))) as `0x${string}`)

    // Create commitment hashes
    const dataCommitment = keccak256(
      encodePacked(["string", "bytes32"], [params.invoiceData, salt])
    )
    const amountCommitment = keccak256(
      encodePacked(["string", "bytes32"], [params.amount, salt])
    )

    // Convert due date to unix timestamp
    const dueDateUnix = BigInt(Math.floor(params.dueDate.getTime() / 1000))

    appendMintLog("info", "sending mint transaction")
    try {
      if (!address) {
        throw new Error("Wallet address unavailable")
      }

      // Ensure wallet is on the correct chain (Monad Testnet = 10143).
      // This prevents txs being silently submitted to the wrong network when
      // MetaMask has drifted to a different chain since the page loaded.
      const MONAD_TESTNET_CHAIN_ID = 10143
      if (chainId !== MONAD_TESTNET_CHAIN_ID) {
        appendMintLog("info", `switching to Monad Testnet (currently on chain ${chainId})`)
        try {
          await switchChainAsync({ chainId: MONAD_TESTNET_CHAIN_ID })
        } catch {
          throw new Error("Please switch your wallet to Monad Testnet and try again")
        }
      }

      // Use writeContractAsync directly — let the wallet handle gas estimation.
      // Previously we used simulateContract → writeContract which injected a
      // legacy type-0 gasPrice, causing txs to get stuck on production HTTPS
      // (MetaMask handles EIP-1559 gas differently on localhost vs HTTPS).
      await writeContractAsync({
        address: contractAddress,
        abi: InvoiceNFTABI,
        functionName: "mint",
        args: [dataCommitment, amountCommitment, dueDateUnix],
        chainId: MONAD_TESTNET_CHAIN_ID,
      })
      appendMintLog("info", "transaction broadcast")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mint simulation failed"
      appendMintLog("error", message)
      throw error
    }

    // Return salt so it can be stored for later verification
    return { salt, dataCommitment, amountCommitment }
  }

  return {
    mint,
    hash,
    isPending,
    isConfirming: isConfirming && !forcedReceipt,
    isSuccess: resolvedIsSuccess,
    mintedTokenId,
    confirmationTimedOut,
    error,
    mintLogs,
    forceSettle,
    isForceChecking,
  }
}

export function useUserInvoices() {
  const chainId = useChainId()
  const { address } = useAccount()
  const contractAddress = getInvoiceNFTAddress(chainId)

  const { data: balance } = useReadContract({
    address: contractAddress,
    abi: InvoiceNFTABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  // This would need to be implemented differently to get all user tokens
  // For now, we'll just return the balance
  return {
    balance: balance ? Number(balance) : 0,
  }
}

// x402 Payment hook - allows clients to pay invoices on-chain
export function usePayInvoice() {
  const chainId = useChainId()
  const contractAddress = getInvoiceNFTAddress(chainId)

  const { writeContract, data: hash, isPending, error } = useWriteContract()

  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({
    hash,
  })

  const payInvoice = (tokenId: bigint, amount: bigint) => {
    writeContract({
      address: contractAddress,
      abi: InvoiceNFTABI,
      functionName: "payInvoice",
      args: [tokenId],
      value: amount,
    })
  }

  return {
    payInvoice,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  }
}

// Helper function to get status label
function getStatusLabel(status: InvoiceStatus): string {
  const labels: Record<InvoiceStatus, string> = {
    [InvoiceStatus.Active]: "Active",
    [InvoiceStatus.InYield]: "In Yield",
    [InvoiceStatus.Paid]: "Paid",
    [InvoiceStatus.Defaulted]: "Defaulted",
    [InvoiceStatus.Cancelled]: "Cancelled",
  }
  return labels[status] || "Unknown"
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { useAccount } from "wagmi"

type CVIState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "verified"; tier: string; expirationTime: number; countries: string[]; source: string }
  | { status: "unverified"; reason: string; magickLink?: string }
  | { status: "unconfigured" }   // Cleanverse not wired up (dev / sandbox)

/** Returned by onboard() so callers can surface the on-chain proof. */
export interface OnboardResult {
  txHash?: string      // MockCVI.verify() Monad Testnet transaction
  cvRecordId?: string  // Cleanverse A-Pass record ID
}

export function useCleanverseCVI() {
  const { address, isConnected } = useAccount()
  const [state, setState] = useState<CVIState>({ status: "idle" })

  const check = useCallback(async () => {
    if (!address) {
      setState({ status: "idle" })
      return
    }
    setState({ status: "loading" })
    try {
      const res = await fetch("/api/cleanverse/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chain: "monad" }),
      })
      const data = await res.json()

      if (data.reason === "unconfigured") {
        setState({ status: "unconfigured" })
      } else if (data.verified) {
        setState({
          status: "verified",
          tier: data.tier,
          expirationTime: data.expirationTime,
          countries: Array.isArray(data.countries) ? data.countries : [],
          // 'cleanverse': query_apass live  |  'mock-cvi-onchain': on-chain fallback  |  'local': unconfigured/error
          source: typeof data.source === 'string' ? data.source : 'local',
        })
      } else {
        setState({ status: "unverified", reason: data.reason ?? "unknown", magickLink: data.magickLink })
      }
    } catch {
      setState({ status: "unverified", reason: "api_error" })
    }
  }, [address])

  /** Run the full KYB onboarding flow: generate_apass → query_apass → MockCVI.verify().
   *  Returns the on-chain txHash and Cleanverse cvRecordId on success. */
  const onboard = useCallback(async (): Promise<OnboardResult | undefined> => {
    if (!address) return undefined
    setState({ status: "onboarding" })
    try {
      const res = await fetch("/api/cleanverse/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      })
      const data = await res.json() as {
        success: boolean
        txHash?: string
        cvRecordId?: string
        reason?: string
      }
      if (data.success) {
        await check()
        return { txHash: data.txHash, cvRecordId: data.cvRecordId }
      } else {
        setState({ status: "unverified", reason: data.reason ?? "onboard_failed" })
        return undefined
      }
    } catch {
      setState({ status: "unverified", reason: "api_error" })
      return undefined
    }
  }, [address, check])

  useEffect(() => {
    if (isConnected && address) {
      void check()
    } else {
      setState({ status: "idle" })
    }
  }, [address, isConnected, check])

  return { state, refresh: check, onboard }
}

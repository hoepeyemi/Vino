"use client"

import { useCallback, useEffect, useState } from "react"
import { useAccount } from "wagmi"

type CVIState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "verified"; tier: string; expirationTime: number }
  | { status: "unverified"; reason: string; magickLink?: string }
  | { status: "unconfigured" }   // Cleanverse not wired up (dev / sandbox)

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
        setState({ status: "verified", tier: data.tier, expirationTime: data.expirationTime })
      } else {
        setState({ status: "unverified", reason: data.reason ?? "unknown", magickLink: data.magickLink })
      }
    } catch {
      setState({ status: "unverified", reason: "api_error" })
    }
  }, [address])

  const onboard = useCallback(async () => {
    if (!address) return
    setState({ status: "onboarding" })
    try {
      const res = await fetch("/api/cleanverse/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      })
      const data = await res.json()
      if (data.success) {
        await check()
      } else {
        setState({ status: "unverified", reason: data.reason ?? "onboard_failed" })
      }
    } catch {
      setState({ status: "unverified", reason: "api_error" })
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

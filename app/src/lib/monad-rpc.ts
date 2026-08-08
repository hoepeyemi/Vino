import { fallback, http } from "viem"

function uniqueUrls(urls: Array<string | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))]
}

export function getMonadTestnetRpcUrls(): string[] {
  return uniqueUrls([
    process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC,
    "https://testnet-rpc.monad.xyz",
  ])
}

export function createMonadTestnetTransport() {
  const urls = getMonadTestnetRpcUrls()
  return fallback(urls.map((url) => http(url)))
}

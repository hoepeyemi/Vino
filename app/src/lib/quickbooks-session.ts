import type { QuickBooksTokens } from "./quickbooks"

const DEFAULT_SESSION_KEY = "default"
const tokenStore = new Map<string, QuickBooksTokens>()

export function storeQuickBooksTokens(tokens: QuickBooksTokens, sessionKey = DEFAULT_SESSION_KEY) {
  tokenStore.set(sessionKey, tokens)
}

export function getQuickBooksTokens(sessionKey = DEFAULT_SESSION_KEY) {
  return tokenStore.get(sessionKey)
}

export function clearQuickBooksTokens(sessionKey = DEFAULT_SESSION_KEY) {
  tokenStore.delete(sessionKey)
}


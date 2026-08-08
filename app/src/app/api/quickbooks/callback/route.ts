import { NextRequest, NextResponse } from "next/server"
import { exchangeCodeForTokens } from "@/lib/quickbooks"
import { isQuickBooksConfigured } from "@/lib/quickbooks-demo"
import { storeQuickBooksTokens } from "@/lib/quickbooks-session"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL
  // Guard against the placeholder string being present (not yet replaced at startup)
  const appUrl = (configuredUrl && !configuredUrl.startsWith("__")) ? configuredUrl : origin
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const realmId = searchParams.get("realmId") || searchParams.get("realm_id")
  const state = searchParams.get("state")
  const stateCookie = request.cookies.get("quickbooks_oauth_state")?.value
  // Must use the same redirect URI that was sent in the authorization request
  const redirectUri =
    request.cookies.get("quickbooks_redirect_uri")?.value ||
    `${origin}/api/quickbooks/callback`

  if (!isQuickBooksConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/mint?quickbooks=demo", appUrl))
  }

  const intuitError = searchParams.get("error")
  if (intuitError) {
    const desc = searchParams.get("error_description") ?? "(no description)"
    console.error(`[QuickBooks callback] Intuit returned error: ${intuitError} — ${desc}`)
    return NextResponse.redirect(new URL("/dashboard/mint?error=quickbooks_auth_failed", appUrl))
  }

  if (!code || !realmId) {
    console.error("[QuickBooks callback] Missing code or realmId", { code: !!code, realmId: !!realmId })
    return NextResponse.redirect(new URL("/dashboard/mint?error=quickbooks_auth_failed", appUrl))
  }

  if (stateCookie && state && stateCookie !== state) {
    console.error("[QuickBooks callback] State mismatch", { stateCookie, state })
    return NextResponse.redirect(new URL("/dashboard/mint?error=quickbooks_auth_failed", appUrl))
  }

  try {
    const tokens = await exchangeCodeForTokens(code, realmId, redirectUri)
    storeQuickBooksTokens(tokens)

    const response = NextResponse.redirect(new URL("/dashboard/mint?quickbooks=success", appUrl))
    response.cookies.delete("quickbooks_oauth_state")
    response.cookies.delete("quickbooks_redirect_uri")
    return response
  } catch (err) {
    console.error("[QuickBooks callback] token exchange failed:", err)
    return NextResponse.redirect(new URL("/dashboard/mint?error=quickbooks_auth_failed", appUrl))
  }
}

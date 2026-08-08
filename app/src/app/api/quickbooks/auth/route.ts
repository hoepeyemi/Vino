import { NextRequest, NextResponse } from "next/server"
import { getAuthorizationUrl } from "@/lib/quickbooks"
import { isQuickBooksConfigured } from "@/lib/quickbooks-demo"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL
  const appUrl = (configuredUrl && !configuredUrl.startsWith("__")) ? configuredUrl : origin

  if (!isQuickBooksConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/mint?quickbooks=demo", appUrl))
  }

  try {
    const state = crypto.randomUUID()
    // Use QUICKBOOKS_REDIRECT_URI env var when explicitly set (required for
    // production servers where the origin is a raw IP — Intuit rejects IPs).
    // Falls back to deriving from request origin for local dev.
    const redirectUri =
      process.env.QUICKBOOKS_REDIRECT_URI || `${appUrl}/api/quickbooks/callback`
    const authUrl = getAuthorizationUrl(state, redirectUri)

    const response = NextResponse.redirect(authUrl)
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    }
    response.cookies.set("quickbooks_oauth_state", state, cookieOpts)
    // Store the redirect URI so the callback uses exactly the same value
    // when exchanging the authorization code for tokens.
    response.cookies.set("quickbooks_redirect_uri", redirectUri, cookieOpts)
    return response
  } catch (err) {
    console.error("[QuickBooks auth] failed to build authorization URL:", err)
    return NextResponse.redirect(new URL("/dashboard/mint?error=quickbooks_auth_failed", appUrl))
  }
}

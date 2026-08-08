import { NextResponse } from "next/server"
import { fetchInvoices, formatInvoiceForDisplay, refreshAccessToken } from "@/lib/quickbooks"
import { getDemoQuickBooksInvoices, isQuickBooksConfigured } from "@/lib/quickbooks-demo"
import { clearQuickBooksTokens, getQuickBooksTokens, storeQuickBooksTokens } from "@/lib/quickbooks-session"

export const dynamic = "force-dynamic"

const SESSION_KEY = "default"

export async function GET() {
  try {
    if (!isQuickBooksConfigured()) {
      const invoices = getDemoQuickBooksInvoices().map(formatInvoiceForDisplay)

      return NextResponse.json({
        success: true,
        data: {
          invoices,
          total: invoices.length,
          demo: true,
        },
      })
    }

    const storedTokens = getQuickBooksTokens(SESSION_KEY)
    if (!storedTokens) {
      return NextResponse.json(
        {
          success: false,
          requiresAuth: true,
          error: "QuickBooks is not connected yet.",
        }
      )
    }

    let tokens = storedTokens
    if (tokens.expiresAt && tokens.expiresAt <= Date.now() + 60_000) {
      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken)
        tokens = {
          ...refreshed,
          realmId: tokens.realmId,
        }
        storeQuickBooksTokens(tokens, SESSION_KEY)
      } catch {
        clearQuickBooksTokens(SESSION_KEY)
        return NextResponse.json(
          {
            success: false,
            requiresAuth: true,
            error: "QuickBooks session expired. Please reconnect.",
          }
        )
      }
    }

    const qbInvoices = await fetchInvoices(tokens.accessToken, tokens.realmId, { status: "open" })
    const invoices = qbInvoices.map(formatInvoiceForDisplay)

    return NextResponse.json({
      success: true,
      data: {
        invoices,
        total: invoices.length,
        demo: false,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch invoices"
    return NextResponse.json(
      {
        success: false,
        requiresAuth: /401|unauthorized|token|auth/i.test(message),
        error: message,
      },
      { status: 500 }
    )
  }
}

import { NextResponse } from "next/server"
import { getActiveInvoices, getInvoice, getDeposit, getAccruedYield } from "@/lib/contracts/server"

export const dynamic = "force-dynamic"

function formatInvoiceStatus(status: number): string {
  switch (status) {
    case 0:
      return "Minted"
    case 1:
      return "InYield"
    case 2:
      return "Paid"
    case 3:
      return "Defaulted"
    case 4:
      return "Cancelled"
    default:
      return "Unknown"
  }
}

function formatStrategy(strategy: number): string {
  switch (strategy) {
    case 0:
      return "Hold"
    case 1:
      return "Conservative"
    case 2:
      return "Aggressive"
    default:
      return "Unknown"
  }
}

export async function GET() {
  try {
    const activeInvoices = await getActiveInvoices()

    const invoices = await Promise.all(
      activeInvoices.map(async (tokenId) => {
        const [invoice, deposit] = await Promise.all([
          getInvoice(tokenId),
          getDeposit(tokenId),
        ])

        if (!invoice) {
          return null
        }

        const accruedYield = deposit?.active ? await getAccruedYield(tokenId) : BigInt(0)

        return {
          tokenId: tokenId.toString(),
          dueDate: new Date(Number(invoice.dueDate) * 1000).toISOString(),
          createdAt: new Date(Number(invoice.createdAt) * 1000).toISOString(),
          status: formatInvoiceStatus(Number(invoice.status)),
          riskScore: invoice.riskScore,
          paymentProbability: invoice.paymentProbability,
          issuer: invoice.issuer,
          deposit: deposit?.active
            ? {
                principal: deposit.principal.toString(),
                accruedYield: accruedYield.toString(),
                strategy: formatStrategy(Number(deposit.strategy)),
                strategyCode: Number(deposit.strategy),
              }
            : null,
        }
      })
    )

    return NextResponse.json({
      success: true,
      data: {
        invoices: invoices.filter((invoice) => invoice !== null),
        total: activeInvoices.length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch invoices"
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}

"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Loader2, CheckCircle2, Link2, RefreshCw } from "lucide-react"

interface QuickBooksInvoice {
  id: string
  docNumber: string
  customerName: string
  amount: number
  balance: number
  dueDate: string
  isPaid: boolean
}

interface QuickBooksConnectProps {
  onInvoiceSelect?: (invoice: QuickBooksInvoice) => void
  selectedInvoiceId?: string | null
}

export function QuickBooksConnect({
  onInvoiceSelect,
  selectedInvoiceId,
}: QuickBooksConnectProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [invoices, setInvoices] = useState<QuickBooksInvoice[]>([])
  const [error, setError] = useState<string | null>(null)

  // Check connection status and fetch invoices on mount
  useEffect(() => {
    checkConnectionAndFetchInvoices()
  }, [])

  async function checkConnectionAndFetchInvoices() {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/quickbooks/invoices")
      const data = await response.json()

      if (data.success) {
        setIsConnected(true)
        setInvoices(data.data.invoices || [])
      } else if (data.requiresAuth) {
        setIsConnected(false)
      } else {
        setError(data.error || "Failed to fetch invoices")
      }
    } catch {
      setError("Failed to connect to QuickBooks")
    } finally {
      setIsLoading(false)
    }
  }

  function handleConnect() {
    // Redirect to QuickBooks OAuth
    window.location.href = "/api/quickbooks/auth"
  }

  function handleRefresh() {
    checkConnectionAndFetchInvoices()
  }

  if (isLoading) {
    return (
      <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] p-6">
        <div className="flex items-center justify-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-[#10b981]" />
          <span className="text-[11px] font-mono text-[#555555]">
            checking QuickBooks connection…
          </span>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] p-6">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded border border-[#1f1f1f] bg-[#111111] flex items-center justify-center">
            <Link2 className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h3 className="text-[12px] font-mono font-semibold text-[#e5e5e5] mb-1 uppercase tracking-wider">
              Connect QuickBooks
            </h3>
            <p className="text-[11px] font-mono text-[#555555]">
              Import real invoices from QuickBooks to tokenize on-chain
            </p>
          </div>
          <button
            onClick={handleConnect}
            className="inline-flex items-center gap-2 text-[10px] font-mono font-semibold uppercase tracking-wider px-4 py-2 rounded border border-[#10b981]/50 text-[#10b981] bg-[#10b981]/10 hover:bg-[#10b981]/20 hover:border-[#10b981] transition-colors"
          >
            <Link2 className="w-3 h-3" />
            Connect QuickBooks
          </button>
          {error && (
            <p className="text-[10px] font-mono text-[#ef4444]">{error}</p>
          )}
          <p className="text-[9px] font-mono text-[#333333]">
            Optional — or fill the form below manually
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#10b981]" />
          <span className="text-[11px] font-mono font-semibold text-[#10b981] uppercase tracking-wider">
            QuickBooks Connected
          </span>
        </div>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 text-[9px] font-mono text-[#555555] hover:text-[#10b981] transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          refresh
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-[10px] font-mono text-[#555555]">No open invoices found in QuickBooks</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          <p className="text-[9px] font-mono text-[#333333] mb-3">
            SELECT INVOICE TO TOKENIZE — {invoices.length} OPEN
          </p>
          {invoices.map((invoice) => (
            <button
              key={invoice.id}
              onClick={() => onInvoiceSelect?.(invoice)}
              className={`w-full text-left p-3 rounded border transition-all ${
                selectedInvoiceId === invoice.id
                  ? "border-[#10b981] bg-[#10b981]/10"
                  : "border-[#1f1f1f] hover:border-[#10b981]/50 bg-[#111111]"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono font-semibold text-[#e5e5e5]">
                  #{invoice.docNumber}
                </span>
                <Badge
                  variant="outline"
                  className={
                    invoice.isPaid
                      ? "text-[9px] font-mono text-[#555555] border-[#1f1f1f] bg-transparent"
                      : "text-[9px] font-mono bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30"
                  }
                >
                  {invoice.isPaid ? "PAID" : "OPEN"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-[#555555]">{invoice.customerName}</span>
                <span className="text-[11px] font-mono font-semibold text-[#e5e5e5]">
                  ${invoice.amount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] font-mono text-[#333333]">
                  due {new Date(invoice.dueDate).toLocaleDateString()}
                </span>
                {invoice.balance < invoice.amount && (
                  <span className="text-[9px] font-mono text-[#333333]">
                    bal ${invoice.balance.toLocaleString()}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[10px] font-mono text-[#ef4444] mt-4">{error}</p>
      )}
    </div>
  )
}

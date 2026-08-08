import type { QuickBooksInvoice } from "./quickbooks"

const DEMO_INVOICES: QuickBooksInvoice[] = [
  {
    Id: "QB-1001",
    DocNumber: "1001",
    CustomerRef: { value: "c1", name: "Acme Corporation" },
    TotalAmt: 25000,
    Balance: 25000,
    DueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    TxnDate: new Date().toISOString().slice(0, 10),
    EmailStatus: "NotSet",
    BillEmail: { Address: "ap@acme.example" },
    Line: [
      {
        Description: "Invoice processing services",
        Amount: 25000,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "item-1", name: "Services" },
          Qty: 1,
          UnitPrice: 25000,
        },
      },
    ],
  },
  {
    Id: "QB-1002",
    DocNumber: "1002",
    CustomerRef: { value: "c2", name: "Northwind Trading" },
    TotalAmt: 18750,
    Balance: 8750,
    DueDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    TxnDate: new Date().toISOString().slice(0, 10),
    EmailStatus: "NotSet",
    BillEmail: { Address: "finance@northwind.example" },
    Line: [
      {
        Description: "Net 30 fulfillment invoice",
        Amount: 18750,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "item-2", name: "Fulfillment" },
          Qty: 1,
          UnitPrice: 18750,
        },
      },
    ],
  },
]

export function getDemoQuickBooksInvoices(): QuickBooksInvoice[] {
  return DEMO_INVOICES.map((invoice) => ({
    ...invoice,
    CustomerRef: { ...invoice.CustomerRef },
    BillEmail: invoice.BillEmail ? { ...invoice.BillEmail } : undefined,
    Line: invoice.Line.map((line) => ({
      ...line,
      SalesItemLineDetail: line.SalesItemLineDetail
        ? {
            ...line.SalesItemLineDetail,
            ItemRef: { ...line.SalesItemLineDetail.ItemRef },
          }
        : undefined,
    })),
  }))
}

export function isQuickBooksConfigured(): boolean {
  return Boolean(
    process.env.QUICKBOOKS_CLIENT_ID &&
      process.env.QUICKBOOKS_CLIENT_SECRET
  )
}


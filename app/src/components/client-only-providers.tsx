"use client"

import dynamic from "next/dynamic"

// Portal-based components that cause React 19 hydration error #418 when statically
// prerendered in Node.js. Loaded only in the browser via ssr:false inside this
// Client Component wrapper (ssr:false is forbidden in Server Components).
const Toaster = dynamic(() => import("sonner").then((m) => m.Toaster), { ssr: false })
const KeyboardShortcutsProvider = dynamic(
  () =>
    import("@/components/keyboard-shortcuts-provider").then(
      (m) => m.KeyboardShortcutsProvider
    ),
  { ssr: false }
)

export function ClientOnlyProviders() {
  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#111111",
            border: "1px solid #1f1f1f",
            color: "#e5e5e5",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      />
      <KeyboardShortcutsProvider />
    </>
  )
}

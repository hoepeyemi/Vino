import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { LiveBackground } from "@/components/live-background";
import { ClientOnlyProviders } from "@/components/client-only-providers";

export const metadata: Metadata = {
  title: "vino - AI Treasury Agent",
  description: "Autonomous AI manages your invoices 24/7. Tokenize, optimize yield, settle via x402.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-mono antialiased bg-[#0a0a0a] text-[#e5e5e5] scan-pulse corner-glow" suppressHydrationWarning>
        <LiveBackground />
        <Providers>{children}</Providers>
        <ClientOnlyProviders />
      </body>
    </html>
  );
}

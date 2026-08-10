import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "./_components/site-header";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "AI Component Ecosystem Portal",
    template: "%s · AI Component Portal",
  },
  description:
    "A centralized registry and template hub for AI components: Skills, Plugins, Agents, and MCP Gateways.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(geist.variable)}>
      <body className="flex min-h-screen flex-col antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}

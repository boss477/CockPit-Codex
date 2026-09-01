import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebMCP Forge",
  description:
    "Generate WebMCP tools from a web app, then prove which ones are safe for an agent to use.",
  authors: [{ name: "Developed with OpenAI Codex" }],
};

/**
 * WebMCP runs as a Chrome origin trial, which is gated per-origin by a token
 * registered against the deployed domain. localhost is exempt; a Vercel domain
 * is not, so without this meta tag document.modelContext is simply absent for
 * visitors — including judges.
 *
 * Register the domain, then set NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN.
 */
const originTrialToken = process.env.NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {originTrialToken && <meta httpEquiv="origin-trial" content={originTrialToken} />}
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DecisionLoop",
  description:
    "Assumption-aware decision memory. Remembers why a decision was made, notices when new evidence invalidates it, and proves it with a CockroachDB-backed Memory Inspector.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

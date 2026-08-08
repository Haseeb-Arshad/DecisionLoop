import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}

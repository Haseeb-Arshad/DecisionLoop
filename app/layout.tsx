import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DecisionLoop: decision memory for people and agents",
  description:
    "Record why something was decided, let agents ask what governs their work before they act, and review decisions when evidence contradicts their assumptions.",
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

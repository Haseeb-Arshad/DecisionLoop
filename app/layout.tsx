import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DecisionLoop — decision memory for people and agents",
  description:
    "Give coding agents the reasoning behind your code. Preserve decisions, retrieve the right context, and review evidence when assumptions change.",
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

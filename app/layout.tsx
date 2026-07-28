import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "One post, shared everywhere",
  description:
    "AI agent that transcreates a single Contentstack blog post into per-channel, per-locale social variants with brand + healthcare compliance guardrails.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

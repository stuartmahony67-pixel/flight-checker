import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artwork Flight Checker",
  description: "Preflight PDF and AI artwork for bleed, safety zone, colour usage, and raster risks."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

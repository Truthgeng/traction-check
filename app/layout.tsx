import type { Metadata, Viewport } from "next";
import "@fontsource/bodoni-moda/500.css";
import "@fontsource/bodoni-moda/700.css";
import "@fontsource-variable/public-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Traction Check",
  description: "Paste a project. See if the hype is real.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e8eee9" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

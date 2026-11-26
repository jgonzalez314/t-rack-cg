import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "@/components/ServiceWorker";
import { basePath, isStaticPreview } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "T-rack-CG",
  description: "Track your trading card collection, raw and graded.",
  // The preview on GitHub Pages is not installable, so it has no manifest.
  manifest: isStaticPreview ? undefined : "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "T-rack-CG",
    statusBarStyle: "default",
  },
  icons: {
    icon: `${basePath}/icons/icon-192.png`,
    apple: `${basePath}/icons/apple-touch-icon.png`,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The browser bar matches the page background in light and dark mode.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

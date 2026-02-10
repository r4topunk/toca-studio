import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Toca Studio",
  description: "Explore artworks from curated profiles on Zora.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://ipfs.io" />
        <link rel="preconnect" href="https://arweave.net" />
      </head>
      <body
        className={`${geistMono.variable} font-mono antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

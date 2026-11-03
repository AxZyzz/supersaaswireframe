import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { THEME_INIT } from "@/lib/theme";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SuperSaaS",
  description: "AI-powered outreach platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // the init script may add class="dark" before React hydrates
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}

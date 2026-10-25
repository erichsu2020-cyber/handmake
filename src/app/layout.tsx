import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Handmake",
  description: "上傳圖片或輸入文字，產生 3D 模型",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex w-full max-w-4xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              Handmake
            </Link>
            <Link href="/" className="text-sm text-zinc-600 hover:text-foreground dark:text-zinc-400">
              產生
            </Link>
            <Link href="/history" className="text-sm text-zinc-600 hover:text-foreground dark:text-zinc-400">
              歷史紀錄
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}

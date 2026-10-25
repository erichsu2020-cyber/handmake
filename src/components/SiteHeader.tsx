import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import NavLinks from "@/components/NavLinks";
import { Logo } from "@/components/site-nav";

// userMenu 是伺服器元件（要讀登入狀態），由 layout 傳進來
export default function SiteHeader({ userMenu }: { userMenu: ReactNode }) {
  // 目前頁面的反白要讀網址，放在 Suspense 裡，等待時先顯示沒有反白的連結
  const nav = (className: string) => (
    <nav className={className}>
      <Suspense fallback={<NavLinks static />}>
        <NavLinks />
      </Suspense>
    </nav>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        {nav("hidden items-center gap-1 md:flex")}
        <div className="flex items-center gap-3">
          {userMenu}
          <Link
            href="/create"
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            開始製作
          </Link>
        </div>
      </div>
      {/* 手機版：連結放在第二行，可以左右滑 */}
      {nav("flex gap-1 overflow-x-auto px-4 pb-2 md:hidden")}
    </header>
  );
}

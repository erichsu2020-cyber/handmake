"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, NAV_LINKS } from "@/components/site-nav";

export default function SiteHeader() {
  const pathname = usePathname();
  // /design/history 也會符合 /design，所以挑最長的那個當作目前頁面
  const active = NAV_LINKS.filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;

  const linkClass = (href: string) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
      active === href ? "bg-foreground/5 text-foreground" : "text-muted hover:text-foreground"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/create"
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          開始製作
        </Link>
      </div>
      {/* 手機版：連結放在第二行，可以左右滑 */}
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={linkClass(l.href)}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

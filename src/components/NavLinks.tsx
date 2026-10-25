"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "@/components/site-nav";

function Links({ active }: { active?: string }) {
  return NAV_LINKS.map((l) => (
    <Link
      key={l.href}
      href={l.href}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
        active === l.href ? "bg-foreground/5 text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      {l.label}
    </Link>
  ));
}

function ActiveLinks() {
  const pathname = usePathname();
  // /design/history 也會符合 /design，所以挑最長的那個當作目前頁面
  const active = NAV_LINKS.filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;
  return <Links active={active} />;
}

// static：不讀網址的版本，給 Suspense 等待時顯示
export default function NavLinks({ static: isStatic = false }: { static?: boolean }) {
  return isStatic ? <Links /> : <ActiveLinks />;
}

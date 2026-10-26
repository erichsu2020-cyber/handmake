import Link from "next/link";

// Header 和 Footer 共用
export const NAV_LINKS = [
  { href: "/draw", label: "畫圖" },
  { href: "/design", label: "設計 3D 圖" },
  { href: "/create", label: "製作模型" },
  { href: "/bambu", label: "Bambu 設定" },
  { href: "/print-check", label: "AI 列印檢查" },
  { href: "/history", label: "歷史紀錄" },
  { href: "/design/history", label: "設計紀錄" },
  { href: "/drawings", label: "我的畫作" },
] as const;

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <path d="M12 2 21 7v10l-9 5-9-5V7z" className="fill-accent" />
        <path d="M12 12 21 7M12 12 3 7M12 12v10" className="stroke-background" strokeWidth="1.5" fill="none" />
      </svg>
      小物屋
    </Link>
  );
}

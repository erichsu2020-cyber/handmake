import Link from "next/link";
import { Logo, NAV_LINKS } from "@/components/site-nav";

export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted">把一張圖或一句話，變成可以直接送進 3D 列印機的模型。</p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">功能</p>
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">技術</p>
          <span className="text-muted">OpenAI 圖片生成</span>
          <span className="text-muted">Tripo3D 建模</span>
          <span className="text-muted">STL・3MF・OBJ</span>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-muted">© Handmake・用 AI 把想法印出來</p>
      </div>
    </footer>
  );
}

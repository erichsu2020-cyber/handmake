import { redirect } from "next/navigation";
import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";
import { Logo } from "@/components/site-nav";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";

export const metadata = { title: "登入 | 小物屋" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-screen flex-1 lg:grid-cols-2">
      <BrandPanel />

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight">歡迎回來</h1>
            <p className="text-muted">登入你的帳號，繼續製作 3D 模型。</p>
          </div>
          <Suspense fallback={<div className="h-64" />}>
            <LoginFormWithNext searchParams={searchParams} />
          </Suspense>
          <p className="text-sm text-muted">還沒有帳號？請聯絡網站管理員幫你建立。</p>
        </div>
      </div>
    </main>
  );
}

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const target = safeNext((await searchParams).next);
  // 已經登入就不用再登入一次
  if (await getCurrentUser()) redirect(target);
  return <LoginForm next={target} />;
}

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[#1c1917] p-12 text-[#f5f5f4] lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/40 blur-3xl" />
      <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative [&_svg_path:last-child]:stroke-[#1c1917]">
        <Logo />
      </div>

      <div className="relative flex flex-col gap-6">
        {/* 一層層堆疊起來的列印物件 */}
        <div className="flex flex-col-reverse items-start gap-1" aria-hidden>
          {[56, 72, 84, 88, 80, 64, 44].map((w, i) => (
            <div
              key={i}
              className="animate-print-layer h-2.5 rounded-full bg-accent"
              style={{ width: `${w * 2}px`, opacity: 0.45 + i * 0.08, animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        <h2 className="text-4xl font-bold leading-tight tracking-tight">
          從一張圖，
          <br />
          到拿在手上的模型。
        </h2>
        <p className="max-w-sm text-[#a8a29e]">AI 畫圖、Tripo3D 建模、自動整理成可列印的 STL／3MF／OBJ。</p>
      </div>

      <p className="relative text-xs text-[#a8a29e]">© 小物屋</p>
    </div>
  );
}

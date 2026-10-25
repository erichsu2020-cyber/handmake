import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { listGenerations } from "@/lib/generations";

const STEPS = [
  {
    title: "上傳圖片或輸入文字",
    body: "一張照片、一張草圖，或一句「戴帽子的小貓」都可以。",
  },
  {
    title: "AI 畫出 3D 模型圖",
    body: "OpenAI 把它整理成乾淨、適合建模的 3D 渲染圖。",
  },
  {
    title: "Tripo3D 建立立體模型",
    body: "從圖片產生真正的 3D 網格，可以選擇面數和材質外觀。",
  },
  {
    title: "下載列印檔",
    body: "自動縮放到你要的尺寸，輸出 STL、3MF 或 OBJ。",
  },
];

const FEATURES = [
  { icon: "📐", title: "指定尺寸", body: "依高度、寬度或列印平台大小縮放，單位是公釐。" },
  { icon: "✂️", title: "切開模型", body: "太大的模型切成兩半，平放在平台上分開印。" },
  { icon: "🫙", title: "空心化", body: "設定壁厚、加洩料孔，省線材也省時間。" },
  { icon: "🎨", title: "外觀材質", body: "木頭、金屬、陶瓷等材質，彩色 OBJ 一起輸出。" },
  { icon: "🧮", title: "列印估算", body: "依層高、填充率估算用料重量和列印時間。" },
  { icon: "🧊", title: "3D 預覽", body: "下載前直接在網頁上旋轉、檢查模型。" },
];

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <Steps />
      <Features />
      <Suspense fallback={null}>
        <RecentWorks />
      </Suspense>
      <CallToAction />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="absolute -top-32 right-0 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
        <div className="flex flex-col items-start gap-6">
          <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            圖片 → 3D 模型 → 列印檔
          </span>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            把一張圖，
            <br />
            變成<span className="text-accent">印得出來</span>的模型
          </h1>
          <p className="max-w-md text-lg text-muted">
            上傳照片或輸入一句話，Handmake 用 AI 幫你畫出 3D 造型、建立立體網格，再整理成可以直接送進 3D
            列印機的檔案。
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/create"
              className="rounded-full bg-accent px-6 py-3 font-medium text-white shadow-lg shadow-accent/25 transition-transform hover:-translate-y-0.5"
            >
              開始製作 →
            </Link>
            <Link
              href="/design"
              className="rounded-full border border-line bg-surface px-6 py-3 font-medium transition-colors hover:border-foreground"
            >
              先設計 3D 圖
            </Link>
          </div>
        </div>

        <PrinterIllustration />
      </div>
    </section>
  );
}

// 一台正在一層層印東西的 3D 列印機
function PrinterIllustration() {
  const layers = [
    { w: 44, color: "#fdba74" },
    { w: 52, color: "#fb923c" },
    { w: 58, color: "#f97316" },
    { w: 60, color: "#ea580c" },
    { w: 56, color: "#f97316" },
    { w: 48, color: "#fb923c" },
    { w: 40, color: "#fdba74" },
  ];
  return (
    <div className="animate-float mx-auto w-full max-w-sm" aria-hidden>
      <div className="relative aspect-square rounded-3xl border border-line bg-surface p-6 shadow-2xl shadow-black/10">
        {/* 機架 */}
        <div className="absolute inset-x-6 top-6 h-2 rounded-full bg-foreground/80" />
        <div className="absolute bottom-6 left-6 top-6 w-2 rounded-full bg-foreground/80" />
        <div className="absolute bottom-6 right-6 top-6 w-2 rounded-full bg-foreground/80" />
        {/* 噴頭 */}
        <div className="absolute left-1/2 top-[40%] flex -translate-x-1/2 flex-col items-center">
          <div className="h-8 w-14 rounded-md bg-foreground" />
          <div className="h-3 w-3 bg-foreground [clip-path:polygon(0_0,100%_0,50%_100%)]" />
        </div>
        {/* 正在印的物件 */}
        <div className="absolute bottom-[18%] left-1/2 flex -translate-x-1/2 flex-col-reverse items-center gap-[3px]">
          {layers.map((l, i) => (
            <div
              key={i}
              className="animate-print-layer h-3 rounded-full"
              style={{ width: `${l.w * 2.2}px`, background: l.color, animationDelay: `${i * 0.25}s` }}
            />
          ))}
        </div>
        {/* 平台 */}
        <div className="absolute inset-x-10 bottom-[14%] h-2 rounded-full bg-muted/40" />
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs text-muted">layer 7 / 7</div>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-accent">{eyebrow}</p>
      <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
    </div>
  );
}

function Steps() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-20">
      <SectionTitle eyebrow="怎麼運作" title="四個步驟，從想法到實體" />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex flex-col gap-3 rounded-2xl border border-line bg-surface p-6">
            <span className="font-mono text-4xl font-bold text-accent/30">0{i + 1}</span>
            <h3 className="font-semibold">{s.title}</h3>
            <p className="text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Features() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-20">
        <SectionTitle eyebrow="為列印而生" title="不只是 3D 模型，是能印的 3D 模型" />
        <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-xl">
                {f.icon}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          輸出格式
          {["STL", "3MF", "OBJ（含顏色）"].map((f) => (
            <span key={f} className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-foreground">
              {f}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// 從歷史紀錄挑最近完成的作品展示；沒有作品時整區不顯示
async function RecentWorks() {
  await connection();
  const user = await requireUser();
  const works = (await listGenerations(user.id, 30)).filter((g) => g.outputImageUrl && g.model3d?.status === "done").slice(0, 4);
  if (works.length === 0) return null;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="作品" title="最近做出來的模型" />
        <Link href="/history" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          看全部紀錄 →
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {works.map((g) => (
          <li key={g.id}>
            <Link
              href={`/generations/${g.id}`}
              className="group block overflow-hidden rounded-2xl border border-line bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.outputImageUrl}
                alt={g.prompt || "作品"}
                className="aspect-square w-full object-contain transition-transform duration-300 group-hover:scale-105"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4">
      <div className="relative overflow-hidden rounded-3xl bg-foreground px-8 py-14 text-background">
        <div className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-accent/40 blur-3xl" />
        <div className="relative flex flex-col items-start gap-5">
          <h2 className="text-3xl font-bold tracking-tight">今天就印一個出來吧</h2>
          <p className="max-w-md opacity-70">不需要會 3D 建模，只要有一張圖或一個想法。</p>
          <Link href="/create" className="rounded-full bg-accent px-6 py-3 font-medium text-white">
            開始製作 →
          </Link>
        </div>
      </div>
    </section>
  );
}

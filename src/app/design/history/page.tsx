import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import HistoryActions from "@/components/HistoryActions";
import StorageCleanup from "@/components/StorageCleanup";
import {
  DESIGN_BACKGROUNDS,
  DESIGN_LIGHTING,
  DESIGN_MATERIALS,
  DESIGN_STYLES,
  DESIGN_VIEWS,
} from "@/lib/design-settings";
import { listDesigns } from "@/lib/designs";

export const metadata = { title: "設計紀錄 | Handmake" };

const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

export default function DesignHistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-3xl font-semibold">設計紀錄</h1>
        <Link href="/design" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          ← 回到設計 3D 圖
        </Link>
      </div>
      <StorageCleanup />
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <DesignList />
      </Suspense>
    </main>
  );
}

async function DesignList() {
  await connection(); // 每次都讀最新資料
  const designs = await listDesigns();

  if (designs.length === 0) {
    return <p className="text-zinc-500">還沒有任何設計，先到「設計 3D 圖」產生一張吧。</p>;
  }

  return (
    <ul className="flex flex-col gap-6">
      {designs.map((d) => (
        <li key={d.id} className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{d.subject}</h2>
            <span className="text-sm text-zinc-500">
              {new Date(d.createdAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
          {d.details && <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.details}</p>}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.referenceImageUrl && (
              <figure className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.referenceImageUrl} alt="參考圖" className="aspect-square w-full rounded bg-white object-contain" />
                <figcaption className="text-center text-xs text-zinc-500">參考圖</figcaption>
              </figure>
            )}
            {d.imageUrls.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`設計圖 ${i + 1}`} className="aspect-square w-full rounded bg-white object-contain" />
                <span className="text-center text-xs text-zinc-500">第 {i + 1} 張（點開看大圖）</span>
              </a>
            ))}
          </div>

          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-500">
            <span>風格：{labelOf(DESIGN_STYLES, d.style)}</span>
            <span>材質：{labelOf(DESIGN_MATERIALS, d.material)}</span>
            <span>視角：{labelOf(DESIGN_VIEWS, d.view)}</span>
            <span>光線：{labelOf(DESIGN_LIGHTING, d.lighting)}</span>
            <span>背景：{labelOf(DESIGN_BACKGROUNDS, d.background)}</span>
            {d.colors.length > 0 && (
              <span className="flex items-center gap-1">
                主色：
                {d.colors.map((c) => (
                  <span key={c} title={c} className="inline-block h-3.5 w-3.5 rounded-full border border-zinc-300" style={{ background: c }} />
                ))}
              </span>
            )}
            {d.printFriendly && <span>適合 3D 列印</span>}
          </p>

          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-500">提示詞</summary>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">{d.prompt}</p>
          </details>

          <HistoryActions
            deleteApi={`/api/designs/${d.id}`}
            downloads={d.imageUrls.map((url, i) => ({ label: `下載第 ${i + 1} 張`, url }))}
            className=""
          />
        </li>
      ))}
    </ul>
  );
}

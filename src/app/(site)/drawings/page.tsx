import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import HistoryActions from "@/components/HistoryActions";
import { requireUser } from "@/lib/auth";
import { listDrawings } from "@/lib/drawings";

export const metadata = { title: "我的畫作 | 小物屋" };

export default function DrawingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold">我的畫作</h1>
          <p className="mt-1 text-zinc-500">打開繼續畫，或直接拿去設計 3D 圖、製作模型</p>
        </div>
        <Link href="/draw" className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          ＋ 新畫作
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <DrawingList />
      </Suspense>
    </main>
  );
}

async function DrawingList() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const drawings = await listDrawings(user.id);

  if (drawings.length === 0) {
    return (
      <p className="text-zinc-500">
        還沒有畫作，
        <Link href="/draw" className="underline">
          畫一張
        </Link>
        吧。
      </p>
    );
  }

  const link = "rounded-full border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700";
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {drawings.map((d) => (
        <li
          key={d.id}
          className="flex flex-col overflow-hidden rounded-lg border border-zinc-300 transition-colors hover:border-foreground dark:border-zinc-700"
        >
          <Link href={`/draw/${d.id}`} className="flex flex-col">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.previewUrl} alt="" className="aspect-square w-full bg-white object-contain" />
            <div className="flex flex-col gap-0.5 p-3 text-sm">
              <p className="line-clamp-1 font-medium">{d.title}</p>
              <p className="text-zinc-500">
                {new Date(d.updatedAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}・
                {d.layers.length} 個圖層
              </p>
            </div>
          </Link>
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            <Link href={`/design?drawing=${d.id}`} className={link}>
              設計 3D 圖
            </Link>
            <Link href={`/create?drawing=${d.id}`} className={link}>
              製作模型
            </Link>
          </div>
          <HistoryActions deleteApi={`/api/drawings/${d.id}`} downloads={[{ label: "下載 PNG", url: d.previewUrl }]} />
        </li>
      ))}
    </ul>
  );
}

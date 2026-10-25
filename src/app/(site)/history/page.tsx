import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import HistoryActions from "@/components/HistoryActions";
import StorageCleanup from "@/components/StorageCleanup";
import { requireUser } from "@/lib/auth";
import { listGenerations } from "@/lib/generations";
import { STYLE_PRESETS } from "@/lib/image-settings";

export const metadata = { title: "歷史紀錄 | Handmake" };

const STATUS_LABEL = {
  generating: "產生中",
  converting: "轉檔中",
  uploading: "儲存中",
  texturing: "上材質中",
  processing: "處理中",
  done: "已完成",
  failed: "失敗",
} as const;

export default function HistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">歷史紀錄</h1>
      <StorageCleanup />
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <HistoryList />
      </Suspense>
    </main>
  );
}

async function HistoryList() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const generations = await listGenerations(user.id);

  if (generations.length === 0) {
    return <p className="text-zinc-500">還沒有任何紀錄，先到首頁產生一個吧。</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {generations.map((g) => {
        const style = STYLE_PRESETS.find((s) => s.value === g.style);
        const m = g.model3d;
        return (
          <li
            key={g.id}
            className="flex flex-col overflow-hidden rounded-lg border border-zinc-300 transition-colors hover:border-foreground dark:border-zinc-700"
          >
            <Link href={`/generations/${g.id}`} className="flex flex-1 flex-col">
              {g.outputImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.outputImageUrl} alt="" className="aspect-square w-full bg-white object-contain" />
              ) : (
                // 最早期的資料把圖片存在資料庫裡，沒有網址可以顯示
                <div className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-900">
                  舊資料，沒有圖片
                </div>
              )}
              <div className="flex flex-1 flex-col gap-1 p-3 text-sm">
                <p className="line-clamp-2">{g.prompt || (g.mode === "image" ? "（上傳圖片）" : "（無描述）")}</p>
                <p className="text-zinc-500">
                  {new Date(g.createdAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}
                  {style && style.value !== "none" && `・${style.label}`}
                </p>
                <p className="mt-auto text-zinc-500">
                  {m ? `${STATUS_LABEL[m.status]}${m.format ? `・${m.format}` : ""}` : "尚未轉 3D"}
                </p>
              </div>
            </Link>
            <HistoryActions
              deleteApi={`/api/generations/${g.id}`}
              downloads={[
                ...(g.outputImageUrl ? [{ label: "下載圖片", url: g.outputImageUrl }] : []),
                ...(m?.status === "done" && m.fileUrl ? [{ label: `下載 ${m.format ?? "3D"} 檔`, url: m.fileUrl }] : []),
              ]}
              busy={!!m && m.status !== "done" && m.status !== "failed"}
            />
          </li>
        );
      })}
    </ul>
  );
}

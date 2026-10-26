import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import HistoryActions from "@/components/HistoryActions";
import { requireUser } from "@/lib/auth";
import { CAUSE_CATEGORIES, LIKELIHOODS } from "@/lib/print-review-settings";
import { listPrintReviews } from "@/lib/print-reviews";

export const metadata = { title: "改良紀錄 | 小物屋" };

export default function PrintReviewsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-3xl font-semibold">改良紀錄</h1>
        <Link href="/print-review" className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          ＋ 分析新的成品
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <ReviewList />
      </Suspense>
    </main>
  );
}

async function ReviewList() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const reviews = await listPrintReviews(user.id);

  if (reviews.length === 0) {
    return (
      <p className="text-zinc-500">
        還沒有改良紀錄，
        <Link href="/print-review" className="underline">
          拍一張成品照片來分析
        </Link>
        吧。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reviews.map((r) => {
        // 列出「很可能」的原因；都沒有就列「有可能」的
        const top = r.report.causes.filter((c) => c.likelihood === "high");
        const causes = (top.length > 0 ? top : r.report.causes.filter((c) => c.likelihood === "medium"))
          .map((c) => `${CAUSE_CATEGORIES.find((x) => x.id === c.category)?.label}（${LIKELIHOODS[c.likelihood]}）`)
          .join("、");
        return (
          <li key={r.id} className="flex flex-col rounded-lg border border-zinc-300 transition-colors hover:border-foreground dark:border-zinc-700">
            <Link href={`/print-reviews/${r.id}`} className="flex gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.photoUrls[0]} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="font-medium">{r.sourceName}</span>
                <p className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{r.report.summary}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(r.createdAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}・
                  {causes ? `主要原因：${causes}` : "沒有明顯的主要原因"}・修改 {r.applied.length} 項設定
                </p>
              </div>
            </Link>
            <HistoryActions
              deleteApi={`/api/print-reviews/${r.id}`}
              downloads={r.fixedFileUrl ? [{ label: "下載修正後的 3MF", url: r.fixedFileUrl }] : []}
            />
          </li>
        );
      })}
    </ul>
  );
}

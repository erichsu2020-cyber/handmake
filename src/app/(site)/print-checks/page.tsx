import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import HistoryActions from "@/components/HistoryActions";
import { requireUser } from "@/lib/auth";
import { VERDICTS } from "@/lib/print-check-settings";
import { listPrintChecks } from "@/lib/print-checks";

export const metadata = { title: "檢查紀錄 | 小物屋" };

const TONE = {
  good: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  problem: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

export default function PrintChecksPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-3xl font-semibold">檢查紀錄</h1>
        <Link href="/print-check" className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          ＋ 新的檢查
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <CheckList />
      </Suspense>
    </main>
  );
}

async function CheckList() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const checks = await listPrintChecks(user.id);

  if (checks.length === 0) {
    return (
      <p className="text-zinc-500">
        還沒有檢查紀錄，
        <Link href="/print-check" className="underline">
          檢查一個檔案
        </Link>
        吧。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {checks.map((c) => {
        const verdict = VERDICTS[c.report.verdict];
        return (
          <li key={c.id} className="flex flex-col rounded-lg border border-zinc-300 transition-colors hover:border-foreground dark:border-zinc-700">
            <Link href={`/print-checks/${c.id}`} className="flex gap-3 p-3">
              {c.snapshotUrls[3] ?? c.snapshotUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.snapshotUrls[3] ?? c.snapshotUrls[0]} alt="" className="h-20 w-20 shrink-0 rounded" />
              ) : null}
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.sourceName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[verdict.tone]}`}>{verdict.label}</span>
                </div>
                <p className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{c.report.summary}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(c.createdAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}・
                  {c.requirements.purpose}・修改 {c.applied.length} 項
                </p>
              </div>
            </Link>
            <HistoryActions
              deleteApi={`/api/print-checks/${c.id}`}
              downloads={c.fixedFileUrl ? [{ label: "下載修正後的 3MF", url: c.fixedFileUrl }] : []}
            />
          </li>
        );
      })}
    </ul>
  );
}

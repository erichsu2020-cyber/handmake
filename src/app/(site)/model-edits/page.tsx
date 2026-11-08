import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import HistoryActions from "@/components/HistoryActions";
import { requireUser } from "@/lib/auth";
import { STEM_MODES } from "@/lib/model-edit-settings";
import { listModelEdits } from "@/lib/model-edits";

export const metadata = { title: "修改紀錄 | 小物屋" };

const mm = (v: number[]) => v.map((x) => x.toFixed(1)).join("×");

export default function ModelEditsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-3xl font-semibold">修改紀錄</h1>
        <Link href="/model-edit" className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          ＋ 新的修改
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <EditList />
      </Suspense>
    </main>
  );
}

async function EditList() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const edits = await listModelEdits(user.id);

  if (edits.length === 0) {
    return (
      <p className="text-zinc-500">
        還沒有修改紀錄，
        <Link href="/model-edit" className="underline">
          修改一個模型
        </Link>
        吧。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {edits.map((e) => {
        const thumbnail = e.snapshotUrls[3] ?? e.snapshotUrls[0];
        return (
          <li key={e.id} className="flex flex-col rounded-lg border border-zinc-300 transition-colors hover:border-foreground dark:border-zinc-700">
            <Link href={`/model-edits/${e.id}`} className="flex gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumbnail && <img src={thumbnail} alt="" className="h-20 w-20 shrink-0 rounded" />}
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="font-medium">{e.sourceName}</span>
                <p className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{e.plan.summary}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(e.createdAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}・
                  {mm(e.beforeMm)} → {mm(e.afterMm)} mm
                  {e.stem && `・${STEM_MODES[e.stem.mode]}`}
                </p>
              </div>
            </Link>
            <HistoryActions deleteApi={`/api/model-edits/${e.id}`} downloads={[{ label: "下載 3MF", url: e.fileUrl }]} />
          </li>
        );
      })}
    </ul>
  );
}

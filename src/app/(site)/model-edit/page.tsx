import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import ModelEditForm from "@/components/ModelEditForm";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "AI 改模型 | 小物屋" };

export default function ModelEditPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold">AI 改模型</h1>
          <p className="mt-1 text-zinc-500">
            上傳 3MF，讓 AI 規劃修改：調整尺寸，或在模型底部做鍵盤軸的十字孔，插在機械鍵盤軸上就能按壓回彈。
          </p>
        </div>
        <Link href="/model-edits" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          查看修改紀錄
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  await connection();
  await requireUser();
  return <ModelEditForm />;
}

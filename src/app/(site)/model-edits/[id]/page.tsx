import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ModelEditResult from "@/components/ModelEditResult";
import { requireUser } from "@/lib/auth";
import { getModelEdit } from "@/lib/model-edits";

export const metadata = { title: "AI 改模型結果 | 小物屋" };

export default function ModelEditPage({ params }: PageProps<"/model-edits/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
        <Link href="/model-edits" className="hover:text-foreground">
          ← 修改紀錄
        </Link>
        <Link href="/model-edit" className="hover:text-foreground">
          再改一個
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <Result params={params} />
      </Suspense>
    </main>
  );
}

async function Result({ params }: { params: PageProps<"/model-edits/[id]">["params"] }) {
  await connection(); // 每次都讀最新資料
  const { id } = await params;
  const user = await requireUser();
  const edit = await getModelEdit(id, user.id);
  if (!edit) notFound();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{edit.sourceName}</h1>
        <p className="text-sm text-zinc-500">{new Date(edit.createdAt).toLocaleString("zh-TW")} 修改</p>
      </div>
      <ModelEditResult edit={edit} />
    </>
  );
}

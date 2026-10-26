import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import DrawingEditorLazy from "@/components/DrawingEditorLazy";
import { requireUser } from "@/lib/auth";
import { getDrawing } from "@/lib/drawings";

export const metadata = { title: "畫圖 | 小物屋" };

// 打開已儲存的畫作繼續畫
export default function EditDrawingPage({ params }: PageProps<"/draw/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-3xl font-semibold">畫圖</h1>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <EditDrawing params={params} />
      </Suspense>
    </main>
  );
}

async function EditDrawing({ params }: { params: PageProps<"/draw/[id]">["params"] }) {
  await connection(); // 每次都讀最新資料
  const { id } = await params;
  const user = await requireUser();
  const drawing = await getDrawing(id, user.id);
  if (!drawing) notFound();
  return <DrawingEditorLazy initial={{ id: drawing.id, title: drawing.title, layers: drawing.layers }} />;
}

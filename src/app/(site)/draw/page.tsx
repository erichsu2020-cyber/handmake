import { Suspense } from "react";
import DrawingEditorLazy from "@/components/DrawingEditorLazy";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "畫圖 | 小物屋" };

// 新的畫作；第一次儲存後網址會換成 /draw/<id>
export default function DrawPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-3xl font-semibold">畫圖</h1>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <NewDrawing />
      </Suspense>
    </main>
  );
}

async function NewDrawing() {
  await requireUser();
  return <DrawingEditorLazy />;
}

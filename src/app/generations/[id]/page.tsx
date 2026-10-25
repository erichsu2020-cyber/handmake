import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ModelPanel from "@/components/ModelPanel";
import { getGeneration } from "@/lib/generations";

export default function GenerationPage({ params }: PageProps<"/generations/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <Link href="/history" className="text-sm text-zinc-500 hover:text-foreground">
        ← 回到歷史紀錄
      </Link>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <GenerationDetail params={params} />
      </Suspense>
    </main>
  );
}

async function GenerationDetail({ params }: { params: PageProps<"/generations/[id]">["params"] }) {
  await connection(); // 每次都讀最新資料
  const { id } = await params;
  const generation = await getGeneration(id);
  if (!generation) notFound();
  // 最早期的資料把圖片存在資料庫裡，沒有網址，無法送去 Tripo3D
  if (!generation.outputImageUrl) {
    return <p className="text-zinc-500">這是早期的測試資料，沒有圖片網址，無法轉成 3D 模型。</p>;
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{generation.prompt || "未命名"}</h1>
      <p className="text-sm text-zinc-500">
        {new Date(generation.createdAt).toLocaleString("zh-TW")}
      </p>

      <div className={`grid gap-4 ${generation.inputImageUrl ? "grid-cols-2" : "grid-cols-1"}`}>
        {generation.inputImageUrl && (
          <figure className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={generation.inputImageUrl} alt="上傳的原圖" className="w-full rounded-lg" />
            <figcaption className="text-center text-sm text-zinc-500">原圖</figcaption>
          </figure>
        )}
        <figure className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={generation.outputImageUrl} alt="3D 模型圖" className="w-full rounded-lg" />
          <figcaption className="text-center text-sm text-zinc-500">3D 模型圖</figcaption>
        </figure>
      </div>

      <ModelPanel generationId={generation.id} initialModel3d={generation.model3d} />
    </>
  );
}

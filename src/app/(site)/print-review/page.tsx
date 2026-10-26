import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import PrintReviewForm from "@/components/PrintReviewForm";
import { requireUser } from "@/lib/auth";
import { listBambuFileOptions, listCheckFileOptions } from "@/lib/bambu-file-options";

export const metadata = { title: "成品改良 | 小物屋" };

export default function PrintReviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold">成品改良</h1>
          <p className="mt-1 text-zinc-500">
            拍下已經印好的成品，AI 會對照當初的 3D 模型和列印設定，判斷問題來自模型、列印設定還是材料與機器，並告訴你先改什麼。
          </p>
        </div>
        <Link href="/print-reviews" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          查看改良紀錄
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const [siteFiles, checkFiles] = await Promise.all([listBambuFileOptions(user.id), listCheckFileOptions(user.id)]);
  return <PrintReviewForm siteFiles={siteFiles} checkFiles={checkFiles} />;
}

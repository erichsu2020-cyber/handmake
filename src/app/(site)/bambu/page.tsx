import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import BambuPanel from "@/components/BambuPanel";
import { requireUser } from "@/lib/auth";
import { listBambuModels } from "@/lib/generations";

export const metadata = { title: "Bambu 設定 | Handmake" };

export default function BambuPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Bambu Studio 列印設定</h1>
        <p className="text-zinc-500">
          選一個已完成的 3MF 模型，調好印表機、線材和列印參數，下載後用 Bambu Studio 打開就會自動套用。
        </p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <BambuModels />
      </Suspense>
    </main>
  );
}

async function BambuModels() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const models = await listBambuModels(user.id);

  if (models.length === 0) {
    return (
      <p className="text-zinc-500">
        還沒有完成的 3MF 模型。到
        <Link href="/create" className="mx-1 underline">
          製作模型
        </Link>
        的第 2 步把檔案格式選成 3MF，完成後就會出現在這裡。
      </p>
    );
  }
  return <BambuPanel models={models} />;
}

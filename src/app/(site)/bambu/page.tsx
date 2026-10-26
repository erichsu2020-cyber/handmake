import { connection } from "next/server";
import { Suspense } from "react";
import BambuPanel from "@/components/BambuPanel";
import { requireUser } from "@/lib/auth";
import { listBambuUploads } from "@/lib/bambu-uploads";
import { listBambuModels } from "@/lib/generations";

export const metadata = { title: "Bambu 設定 | 小物屋" };

export default function BambuPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Bambu Studio 列印設定</h1>
        <p className="text-zinc-500">
          開啟網站上完成的 3MF，或從電腦上傳 STL／3MF，調好印表機、線材和列印參數，下載後用 Bambu Studio
          打開就會自動套用。
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
  const [generations, uploads] = await Promise.all([listBambuModels(user.id), listBambuUploads(user.id)]);
  return <BambuPanel generations={generations} uploads={uploads} />;
}

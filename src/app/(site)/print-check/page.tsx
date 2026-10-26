import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import PrintCheckForm, { type CheckSourceOption } from "@/components/PrintCheckForm";
import { requireUser } from "@/lib/auth";
import { findPrinter, type BambuSettings } from "@/lib/bambu-settings";
import { listBambuUploads } from "@/lib/bambu-uploads";
import { listBambuModels } from "@/lib/generations";

export const metadata = { title: "AI 列印檢查 | 小物屋" };

export default function PrintCheckPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold">AI 列印檢查</h1>
          <p className="mt-1 text-zinc-500">
            讓 AI 依你的產品需求，檢查表面品質、強度、擺放與支撐、成本和模型問題，並產出修正後的 Bambu Studio 檔案。
          </p>
        </div>
        <Link href="/print-checks" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          查看檢查紀錄
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <Form />
      </Suspense>
    </main>
  );
}

const describe = (s: BambuSettings) =>
  [findPrinter(s.printer)?.label, s.nozzle && `${s.nozzle} mm`, `Bambu ${s.filament}`, `層高 ${s.layerHeight}`].filter(Boolean).join("・");

async function Form() {
  await connection(); // 每次都讀最新資料
  const user = await requireUser();
  const [generations, uploads] = await Promise.all([listBambuModels(user.id), listBambuUploads(user.id)]);
  // 只列出已經在「Bambu 設定」頁產生過 Bambu 檔的模型
  const sources: CheckSourceOption[] = [
    ...generations.flatMap((g) =>
      g.bambu
        ? [
            {
              type: "generation" as const,
              id: g.id,
              name: g.prompt || (g.mode === "image" ? "（上傳圖片）" : "（無描述）"),
              fileUrl: g.bambu.fileUrl,
              imageUrl: g.outputImageUrl,
              summary: describe(g.bambu.settings),
            },
          ]
        : [],
    ),
    ...uploads.flatMap((u) =>
      u.bambu
        ? [{ type: "upload" as const, id: u.id, name: u.name, fileUrl: u.bambu.fileUrl, summary: describe(u.bambu.settings) }]
        : [],
    ),
  ];
  return <PrintCheckForm sources={sources} />;
}

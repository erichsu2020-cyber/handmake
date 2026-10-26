import "server-only";
import type { BambuFileOption } from "@/components/BambuSourcePicker";
import { findPrinter, type BambuSettings } from "@/lib/bambu-settings";
import { listBambuUploads } from "@/lib/bambu-uploads";
import { listBambuModels } from "@/lib/generations";
import { listPrintChecks } from "@/lib/print-checks";

// 「AI 列印檢查」「成品改良」頁面上可以選的 Bambu 檔

const describe = (s: BambuSettings) =>
  [findPrinter(s.printer)?.label, s.nozzle && `${s.nozzle} mm`, `Bambu ${s.filament}`, `層高 ${s.layerHeight}`].filter(Boolean).join("・");

// 「Bambu 設定」頁產生過 Bambu 檔的模型（網站上的、上傳的）
export async function listBambuFileOptions(userId: string): Promise<BambuFileOption[]> {
  const [generations, uploads] = await Promise.all([listBambuModels(userId), listBambuUploads(userId)]);
  return [
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
}

// 「AI 列印檢查」的紀錄：有修正檔就用修正檔，否則用當初檢查的檔案
export async function listCheckFileOptions(userId: string): Promise<BambuFileOption[]> {
  const checks = await listPrintChecks(userId);
  return checks.map((c) => ({
    type: "check" as const,
    id: c.id,
    name: `${c.sourceName}${c.fixedFileUrl ? "（AI 修正版）" : ""}`,
    fileUrl: c.fixedFileUrl ?? c.sourceFileUrl,
    imageUrl: c.snapshotUrls[3] ?? c.snapshotUrls[0],
    summary: `${new Date(c.createdAt).toLocaleDateString("zh-TW")} 檢查・${c.requirements.purpose}・${
      c.fixedFileUrl ? `套用 ${c.applied.length} 項修改` : "原始檔"
    }`,
  }));
}

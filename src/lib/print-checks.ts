import "server-only";
import { isValidObjectId } from "mongoose";
import { put } from "@vercel/blob";
import {
  analyzeGeometry,
  applySettingChanges,
  editableSpecs,
  estimateFromProject,
  readBambuProject,
  summarizeSettings,
  type AppliedChange,
  type GeometryReport,
  type RejectedChange,
  type SettingRow,
} from "@/lib/bambu-project";
import { connectDB } from "@/lib/mongodb";
import { ownBlobUrl } from "@/lib/own-blob";
import { TEXT_MODEL, runAiCheck } from "@/lib/print-check-ai";
import {
  MAX_PRINT_CHECK_UPLOAD_BYTES,
  MAX_SNAPSHOTS,
  PRINT_CHECK_FOLDER,
  PRINT_CHECK_SNAPSHOT_FOLDER,
  PRINT_CHECK_UPLOAD_FOLDER,
  type AiReport,
  type PrintRequirements,
} from "@/lib/print-check-settings";
import type { PrintEstimate } from "@/lib/print-estimate";
import { BambuUpload } from "@/models/BambuUpload";
import { Generation } from "@/models/Generation";
import { PrintCheck } from "@/models/PrintCheck";

// 帶 HTTP 狀態碼的錯誤，API 直接把訊息回給使用者
export class PrintCheckError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type CheckSource =
  | { type: "generation"; id: string }
  | { type: "upload"; id: string }
  | { type: "file"; url: string; name: string };

export type PrintCheckView = {
  id: string;
  sourceType: "generation" | "upload" | "file";
  sourceName: string;
  sourceFileUrl: string;
  snapshotUrls: string[];
  requirements: PrintRequirements;
  settings: SettingRow[];
  geometry: GeometryReport;
  estimate: PrintEstimate & { material: string };
  report: AiReport;
  applied: AppliedChange[];
  rejected: RejectedChange[];
  aiModel: string;
  fixedFileUrl?: string;
  createdAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- lean() 回來的文件型別不固定，在這裡統一轉換 */
export function toPrintCheckView(doc: any): PrintCheckView {
  return {
    id: doc._id.toString(),
    sourceType: doc.sourceType,
    sourceName: doc.sourceName,
    sourceFileUrl: doc.sourceFileUrl,
    snapshotUrls: doc.snapshotUrls ?? [],
    requirements: doc.requirements,
    settings: doc.settings,
    geometry: doc.geometry,
    estimate: doc.estimate,
    report: doc.report,
    applied: doc.applied ?? [],
    rejected: doc.rejected ?? [],
    aiModel: doc.aiModel,
    fixedFileUrl: doc.fixedFileUrl,
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// 一律帶 userId：只查得到該帳號自己的紀錄
export async function listPrintChecks(userId: string, limit = 50) {
  await connectDB();
  const docs = await PrintCheck.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toPrintCheckView);
}

export async function getPrintCheck(id: string, userId: string) {
  if (!isValidObjectId(id)) return null;
  await connectDB();
  const doc = await PrintCheck.findOne({ _id: id, userId }).lean();
  return doc ? toPrintCheckView(doc) : null;
}

// 這筆紀錄自己的檔案（刪除時一起刪）；網站上其他紀錄的 Bambu 檔不算
export const printCheckOwnedUrls = (d: { sourceType?: string; sourceFileUrl?: string; snapshotUrls?: string[]; fixedFileUrl?: string | null }) => [
  ...(d.sourceType === "file" ? [d.sourceFileUrl] : []),
  ...(d.snapshotUrls ?? []),
  d.fixedFileUrl ?? undefined,
];

async function resolveSource(userId: string, source: CheckSource) {
  if (source.type === "file") {
    if (!ownBlobUrl(source.url, PRINT_CHECK_UPLOAD_FOLDER)) throw new PrintCheckError("檔案網址不正確", 400);
    return { sourceType: "file" as const, sourceName: source.name.trim().slice(0, 200) || "上傳的 3MF", fileUrl: source.url };
  }
  if (!isValidObjectId(source.id)) throw new PrintCheckError("找不到這個模型", 404);
  await connectDB();
  if (source.type === "generation") {
    const g = await Generation.findOne({ _id: source.id, userId }, { prompt: 1, mode: 1, bambu: 1 }).lean();
    if (!g) throw new PrintCheckError("找不到這個模型", 404);
    if (!g.bambu?.fileUrl) throw new PrintCheckError("這個模型還沒有產生 Bambu 檔，請先到「Bambu 設定」產生", 400);
    return {
      sourceType: "generation" as const,
      sourceId: source.id,
      sourceName: g.prompt || (g.mode === "image" ? "（上傳圖片）" : "（無描述）"),
      fileUrl: g.bambu.fileUrl,
    };
  }
  const u = await BambuUpload.findOne({ _id: source.id, userId }, { name: 1, bambu: 1 }).lean();
  if (!u) throw new PrintCheckError("找不到這個模型", 404);
  if (!u.bambu?.fileUrl) throw new PrintCheckError("這個模型還沒有產生 Bambu 檔，請先到「Bambu 設定」產生", 400);
  return { sourceType: "upload" as const, sourceId: source.id, sourceName: u.name, fileUrl: u.bambu.fileUrl };
}

export async function runPrintCheck(
  userId: string,
  source: CheckSource,
  requirements: PrintRequirements,
  snapshotUrls: string[],
) {
  if (snapshotUrls.length > MAX_SNAPSHOTS) throw new PrintCheckError(`截圖最多 ${MAX_SNAPSHOTS} 張`, 400);
  if (!snapshotUrls.every((u) => ownBlobUrl(u, PRINT_CHECK_SNAPSHOT_FOLDER))) throw new PrintCheckError("截圖網址不正確", 400);

  const resolved = await resolveSource(userId, source);
  const res = await fetch(resolved.fileUrl, { cache: "no-store" });
  if (!res.ok) throw new PrintCheckError(`讀取 3MF 失敗 (${res.status})`, 502);
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_PRINT_CHECK_UPLOAD_BYTES) throw new PrintCheckError("檔案不能超過 50MB", 400);

  let project;
  try {
    project = readBambuProject(input);
  } catch (error) {
    throw new PrintCheckError(error instanceof Error ? error.message : "讀取 3MF 失敗", 400);
  }
  if (!project.config) {
    throw new PrintCheckError("這個 3MF 沒有 Bambu Studio 設定。請用 Bambu Studio「另存專案」，或先到「Bambu 設定」產生", 400);
  }

  const settings = summarizeSettings(project.config);
  const geometry = analyzeGeometry(project);
  const estimate = estimateFromProject(project);
  // Bambu Studio 存的專案有盤面縮圖，一起給 AI 看
  const images = [
    ...snapshotUrls,
    ...(project.thumbnail ? [`data:image/png;base64,${Buffer.from(project.thumbnail).toString("base64")}`] : []),
  ];

  let report: AiReport;
  try {
    report = await runAiCheck({ settings, editable: editableSpecs(project.config), geometry, estimate, requirements, images });
  } catch (error) {
    console.error("AI 列印檢查失敗", error);
    throw new PrintCheckError(error instanceof Error ? `AI 檢查失敗：${error.message}` : "AI 檢查失敗", 502);
  }

  // 套用 AI 建議的設定；超出範圍等不合法的會被擋下，列在報告裡
  let applied: AppliedChange[] = [];
  let rejected: RejectedChange[] = [];
  let fixed: { url: string; pathname: string } | undefined;
  if (report.changes.length > 0) {
    const result = applySettingChanges(project, report.changes);
    applied = result.applied;
    rejected = result.rejected;
    if (applied.length > 0) {
      fixed = await put(`${PRINT_CHECK_FOLDER}fixed/fixed.3mf`, result.buffer, {
        access: "public",
        contentType: "model/3mf",
        addRandomSuffix: true,
      });
    }
  }

  await connectDB();
  const doc = await PrintCheck.create({
    userId,
    sourceType: resolved.sourceType,
    sourceId: "sourceId" in resolved ? resolved.sourceId : undefined,
    sourceName: resolved.sourceName,
    sourceFileUrl: resolved.fileUrl,
    snapshotUrls,
    requirements,
    settings,
    geometry,
    estimate,
    report,
    applied,
    rejected,
    aiModel: TEXT_MODEL,
    fixedFileUrl: fixed?.url,
    fixedFilePathname: fixed?.pathname,
  });
  return toPrintCheckView(doc.toObject());
}

import "server-only";
import { isValidObjectId } from "mongoose";
import {
  editableSpecs,
  type AppliedChange,
  type GeometryReport,
  type RejectedChange,
  type SettingRow,
} from "@/lib/bambu-project";
import {
  UserError,
  loadBambuFile,
  resolveBambuSource,
  saveFixedFile,
  thumbnailDataUrl,
  type BambuSource,
  type BambuSourceType,
} from "@/lib/bambu-source";
import { connectDB } from "@/lib/mongodb";
import { ownBlobUrl } from "@/lib/own-blob";
import { TEXT_MODEL, runAiCheck } from "@/lib/print-check-ai";
import {
  MAX_SNAPSHOTS,
  PRINT_CHECK_FOLDER,
  PRINT_CHECK_SNAPSHOT_FOLDER,
  PRINT_CHECK_UPLOAD_FOLDER,
  type AiReport,
  type PrintRequirements,
} from "@/lib/print-check-settings";
import type { PrintEstimate } from "@/lib/print-estimate";
import { PrintCheck } from "@/models/PrintCheck";

// AI 列印檢查接受的檔案來源
export const CHECK_SOURCE_TYPES = ["generation", "upload", "file"] as const;

export type PrintCheckView = {
  id: string;
  sourceType: BambuSourceType;
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

export async function runPrintCheck(
  userId: string,
  source: BambuSource,
  requirements: PrintRequirements,
  snapshotUrls: string[],
) {
  if (snapshotUrls.length > MAX_SNAPSHOTS) throw new UserError(`截圖最多 ${MAX_SNAPSHOTS} 張`, 400);
  if (!snapshotUrls.every((u) => ownBlobUrl(u, PRINT_CHECK_SNAPSHOT_FOLDER))) throw new UserError("截圖網址不正確", 400);

  const resolved = await resolveBambuSource(userId, source, PRINT_CHECK_UPLOAD_FOLDER);
  const { project, config, settings, geometry, estimate } = await loadBambuFile(resolved.fileUrl);

  let report: AiReport;
  try {
    const images = [...snapshotUrls, ...thumbnailDataUrl(project)];
    report = await runAiCheck({ settings, editable: editableSpecs(config), geometry, estimate, requirements, images });
  } catch (error) {
    console.error("AI 列印檢查失敗", error);
    throw new UserError(error instanceof Error ? `AI 檢查失敗：${error.message}` : "AI 檢查失敗", 502);
  }

  const { applied, rejected, fixed } = await saveFixedFile(project, report.changes, `${PRINT_CHECK_FOLDER}fixed/`);

  await connectDB();
  const doc = await PrintCheck.create({
    userId,
    sourceType: resolved.sourceType,
    sourceId: resolved.sourceId,
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

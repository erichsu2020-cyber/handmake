import "server-only";
import { isValidObjectId } from "mongoose";
import { editableSpecs, type AppliedChange, type GeometryReport, type RejectedChange, type SettingRow } from "@/lib/bambu-project";
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
import { TEXT_MODEL } from "@/lib/print-check-ai";
import { MAX_SNAPSHOTS } from "@/lib/print-check-settings";
import { runAiReview } from "@/lib/print-review-ai";
import {
  MAX_PHOTOS,
  MIN_PHOTOS,
  PRINT_REVIEW_FOLDER,
  PRINT_REVIEW_PHOTO_FOLDER,
  PRINT_REVIEW_SNAPSHOT_FOLDER,
  PRINT_REVIEW_UPLOAD_FOLDER,
  type ReviewDetails,
  type ReviewReport,
} from "@/lib/print-review-settings";
import { PrintReview } from "@/models/PrintReview";

// 成品改良接受的檔案來源（多了「AI 列印檢查」的修正檔）
export const REVIEW_SOURCE_TYPES = ["generation", "upload", "check", "file"] as const;

export type PrintReviewView = {
  id: string;
  sourceType: BambuSourceType;
  sourceName: string;
  sourceFileUrl: string;
  photoUrls: string[];
  snapshotUrls: string[];
  details: ReviewDetails;
  settings: SettingRow[];
  geometry: GeometryReport;
  report: ReviewReport;
  applied: AppliedChange[];
  rejected: RejectedChange[];
  aiModel: string;
  fixedFileUrl?: string;
  createdAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- lean() 回來的文件型別不固定，在這裡統一轉換 */
export function toPrintReviewView(doc: any): PrintReviewView {
  return {
    id: doc._id.toString(),
    sourceType: doc.sourceType,
    sourceName: doc.sourceName,
    sourceFileUrl: doc.sourceFileUrl,
    photoUrls: doc.photoUrls ?? [],
    snapshotUrls: doc.snapshotUrls ?? [],
    details: doc.details,
    settings: doc.settings,
    geometry: doc.geometry,
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
export async function listPrintReviews(userId: string, limit = 50) {
  await connectDB();
  const docs = await PrintReview.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toPrintReviewView);
}

export async function getPrintReview(id: string, userId: string) {
  if (!isValidObjectId(id)) return null;
  await connectDB();
  const doc = await PrintReview.findOne({ _id: id, userId }).lean();
  return doc ? toPrintReviewView(doc) : null;
}

// 這筆紀錄自己的檔案（刪除時一起刪）；網站上其他紀錄的 Bambu 檔不算
export const printReviewOwnedUrls = (d: {
  sourceType?: string;
  sourceFileUrl?: string;
  photoUrls?: string[];
  snapshotUrls?: string[];
  fixedFileUrl?: string | null;
}) => [
  ...(d.sourceType === "file" ? [d.sourceFileUrl] : []),
  ...(d.photoUrls ?? []),
  ...(d.snapshotUrls ?? []),
  d.fixedFileUrl ?? undefined,
];

export async function runPrintReview(
  userId: string,
  source: BambuSource,
  details: ReviewDetails,
  photoUrls: string[],
  snapshotUrls: string[],
) {
  if (photoUrls.length < MIN_PHOTOS || photoUrls.length > MAX_PHOTOS) {
    throw new UserError(`成品照片要 ${MIN_PHOTOS}–${MAX_PHOTOS} 張`, 400);
  }
  if (!photoUrls.every((u) => ownBlobUrl(u, PRINT_REVIEW_PHOTO_FOLDER))) throw new UserError("照片網址不正確", 400);
  if (snapshotUrls.length > MAX_SNAPSHOTS) throw new UserError(`模型截圖最多 ${MAX_SNAPSHOTS} 張`, 400);
  if (!snapshotUrls.every((u) => ownBlobUrl(u, PRINT_REVIEW_SNAPSHOT_FOLDER))) throw new UserError("模型截圖網址不正確", 400);

  const resolved = await resolveBambuSource(userId, source, PRINT_REVIEW_UPLOAD_FOLDER);
  const { project, config, settings, geometry } = await loadBambuFile(resolved.fileUrl);

  let report: ReviewReport;
  try {
    report = await runAiReview({
      source: resolved,
      settings,
      editable: editableSpecs(config),
      geometry,
      details,
      photos: photoUrls,
      modelImages: [...snapshotUrls, ...thumbnailDataUrl(project)],
    });
  } catch (error) {
    console.error("AI 成品分析失敗", error);
    throw new UserError(error instanceof Error ? `AI 分析失敗：${error.message}` : "AI 分析失敗", 502);
  }

  const { applied, rejected, fixed } = await saveFixedFile(project, report.changes, `${PRINT_REVIEW_FOLDER}fixed/`);

  await connectDB();
  const doc = await PrintReview.create({
    userId,
    sourceType: resolved.sourceType,
    sourceId: resolved.sourceId,
    sourceName: resolved.sourceName,
    sourceFileUrl: resolved.fileUrl,
    photoUrls,
    snapshotUrls,
    details,
    settings,
    geometry,
    report,
    applied,
    rejected,
    aiModel: TEXT_MODEL,
    fixedFileUrl: fixed?.url,
    fixedFilePathname: fixed?.pathname,
  });
  return toPrintReviewView(doc.toObject());
}

import "server-only";
import { isValidObjectId } from "mongoose";
import { put } from "@vercel/blob";
import {
  analyzeGeometry,
  applySettingChanges,
  estimateFromProject,
  readBambuProject,
  summarizeSettings,
  type AppliedChange,
  type BambuProject,
  type RejectedChange,
  type SettingChange,
} from "@/lib/bambu-project";
import { connectDB } from "@/lib/mongodb";
import { ownBlobUrl } from "@/lib/own-blob";
import { MAX_PRINT_CHECK_UPLOAD_BYTES, type PrintRequirements, type Verdict } from "@/lib/print-check-settings";
import { BambuUpload } from "@/models/BambuUpload";
import { Generation } from "@/models/Generation";
import { PrintCheck } from "@/models/PrintCheck";

// 「AI 列印檢查」「成品改良」共用：找到使用者選的 Bambu 3MF、讀出設定和模型數據

// 帶 HTTP 狀態碼的錯誤，API 直接把訊息回給使用者
export class UserError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type BambuSource =
  | { type: "generation"; id: string } // 「Bambu 設定」頁網站模型的 Bambu 檔
  | { type: "upload"; id: string } // 「Bambu 設定」頁上傳模型的 Bambu 檔
  | { type: "check"; id: string } // 「AI 列印檢查」的修正檔（沒有修正檔就用原始檔）
  | { type: "file"; url: string; name: string }; // 這頁直接上傳的 3MF
export type BambuSourceType = BambuSource["type"];

// 檢查 API 收到的 source 格式；allowed 限制這個功能接受哪些來源
export function parseSource(input: unknown, allowed: BambuSourceType[]): BambuSource | null {
  const s = (input ?? {}) as Record<string, unknown>;
  if (!allowed.includes(s.type as BambuSourceType)) return null;
  if (s.type === "file") {
    return typeof s.url === "string" && typeof s.name === "string" ? { type: "file", url: s.url, name: s.name } : null;
  }
  return typeof s.id === "string" ? ({ type: s.type, id: s.id } as BambuSource) : null;
}

export type ResolvedSource = {
  sourceType: BambuSourceType;
  sourceId?: string;
  sourceName: string;
  fileUrl: string;
  // 從檢查紀錄來的：當初的產品需求和檢查結論，給 AI 參考
  check?: { requirements: PrintRequirements; verdict: Verdict; summary: string; appliedCount: number };
};

const NO_BAMBU_FILE = "這個模型還沒有產生 Bambu 檔，請先到「Bambu 設定」產生";

// 只找得到自己的紀錄；uploadFolder：type 為 file 時，檔案必須在這個資料夾
export async function resolveBambuSource(userId: string, source: BambuSource, uploadFolder: string): Promise<ResolvedSource> {
  if (source.type === "file") {
    if (!ownBlobUrl(source.url, uploadFolder)) throw new UserError("檔案網址不正確", 400);
    return { sourceType: "file", sourceName: source.name.trim().slice(0, 200) || "上傳的 3MF", fileUrl: source.url };
  }
  if (!isValidObjectId(source.id)) throw new UserError("找不到這個檔案", 404);
  await connectDB();

  if (source.type === "generation") {
    const g = await Generation.findOne({ _id: source.id, userId }, { prompt: 1, mode: 1, bambu: 1 }).lean();
    if (!g) throw new UserError("找不到這個模型", 404);
    if (!g.bambu?.fileUrl) throw new UserError(NO_BAMBU_FILE, 400);
    return {
      sourceType: "generation",
      sourceId: source.id,
      sourceName: g.prompt || (g.mode === "image" ? "（上傳圖片）" : "（無描述）"),
      fileUrl: g.bambu.fileUrl,
    };
  }
  if (source.type === "upload") {
    const u = await BambuUpload.findOne({ _id: source.id, userId }, { name: 1, bambu: 1 }).lean();
    if (!u) throw new UserError("找不到這個模型", 404);
    if (!u.bambu?.fileUrl) throw new UserError(NO_BAMBU_FILE, 400);
    return { sourceType: "upload", sourceId: source.id, sourceName: u.name, fileUrl: u.bambu.fileUrl };
  }
  const c = await PrintCheck.findOne({ _id: source.id, userId }).lean();
  if (!c) throw new UserError("找不到這筆檢查紀錄", 404);
  const report = c.report as { verdict: Verdict; summary: string };
  return {
    sourceType: "check",
    sourceId: source.id,
    sourceName: `${c.sourceName}${c.fixedFileUrl ? "（AI 修正版）" : ""}`,
    fileUrl: c.fixedFileUrl ?? c.sourceFileUrl,
    check: {
      requirements: c.requirements as PrintRequirements,
      verdict: report.verdict,
      summary: report.summary,
      appliedCount: Array.isArray(c.applied) ? c.applied.length : 0,
    },
  };
}

// 下載並分析 Bambu 3MF：設定摘要、模型數據、粗估
export async function loadBambuFile(fileUrl: string) {
  const res = await fetch(fileUrl, { cache: "no-store" });
  if (!res.ok) throw new UserError(`讀取 3MF 失敗 (${res.status})`, 502);
  const input = new Uint8Array(await res.arrayBuffer());
  if (input.length > MAX_PRINT_CHECK_UPLOAD_BYTES) throw new UserError("檔案不能超過 50MB", 400);

  let project;
  try {
    project = readBambuProject(input);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : "讀取 3MF 失敗", 400);
  }
  if (!project.config) {
    throw new UserError("這個 3MF 沒有 Bambu Studio 設定。請用 Bambu Studio「另存專案」，或先到「Bambu 設定」產生", 400);
  }
  return {
    project,
    config: project.config,
    settings: summarizeSettings(project.config),
    geometry: analyzeGeometry(project),
    estimate: estimateFromProject(project),
  };
}

// Bambu Studio 存的專案附有盤面縮圖，跟截圖一起給 AI 看
export const thumbnailDataUrl = (project: { thumbnail?: Uint8Array }) =>
  project.thumbnail ? [`data:image/png;base64,${Buffer.from(project.thumbnail).toString("base64")}`] : [];

// 套用 AI 建議的設定，有成功套用的就另存修正檔；超出範圍等不合法的會被擋下，列在報告裡
export async function saveFixedFile(project: BambuProject, changes: SettingChange[], folder: string) {
  if (changes.length === 0) return { applied: [] as AppliedChange[], rejected: [] as RejectedChange[] };
  const { buffer, applied, rejected } = applySettingChanges(project, changes);
  if (applied.length === 0) return { applied, rejected };
  const fixed = await put(`${folder}fixed.3mf`, buffer, { access: "public", contentType: "model/3mf", addRandomSuffix: true });
  return { applied, rejected, fixed: { url: fixed.url, pathname: fixed.pathname } };
}

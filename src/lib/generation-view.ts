import type { BambuSettings } from "@/lib/bambu-settings";
import type { MeshStats } from "@/lib/print-estimate";
import { migrateSettings, type ModelFormat, type ModelSettings } from "@/lib/print-settings";

// 前端看到的資料格式（API 回傳與頁面 props 共用）

export type Model3dStatus = "generating" | "texturing" | "converting" | "uploading" | "processing" | "done" | "failed";

export type Model3dView = Partial<ModelSettings> & {
  status: Model3dStatus;
  progress: number;
  modelReady?: boolean;
  textureReady?: boolean;
  convertTaskId?: string;
  rawFileUrl?: string;
  fileUrl?: string;
  format?: ModelFormat;
  dimensionsMm?: [number, number, number];
  triangles?: number;
  pieces?: number;
  fileSizeBytes?: number;
  stats?: MeshStats;
  error?: string;
};

export type GenerationView = {
  id: string;
  mode: "text" | "image";
  prompt: string;
  style: string;
  inputImageUrl?: string;
  outputImageUrl: string;
  createdAt: string;
  model3d?: Model3dView;
  bambu?: BambuView;
};

export type BambuView = {
  settings: BambuSettings;
  fileUrl: string;
  fileSizeBytes?: number;
  updatedAt: string;
  // 之後重新處理過 3D 檔，這份 Bambu 檔用的是舊模型
  outdated: boolean;
};

// Bambu 設定頁「從電腦上傳」的模型
export type BambuUploadView = {
  id: string;
  name: string;
  sourceFormat: "STL" | "3MF";
  modelFileUrl: string;
  dimensionsMm: [number, number, number];
  triangles: number;
  pieces: number;
  createdAt: string;
  bambu?: BambuView;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- 舊資料欄位不固定，在這裡統一轉換 */
export function toModel3dView(m: any): Model3dView | undefined {
  if (!m) return undefined;
  const { modelTaskId, textureTaskId, rawFilePathname, filePathname, processingClaimedAt, uploadAttempts, ...rest } = m;
  void [modelTaskId, textureTaskId, rawFilePathname, filePathname, processingClaimedAt, uploadAttempts];
  return {
    ...migrateSettings(rest),
    // 「搶到下一步」時的暫時狀態，對前端來說還是同一個階段
    status: String(m.status).replace(":claimed", "") as Model3dStatus,
    progress: m.progress ?? 0,
    // 舊資料只有 stlUrl，而且一定是 STL
    fileUrl: m.fileUrl ?? m.stlUrl,
    format: m.format ?? (m.stlUrl ? "STL" : undefined),
  };
}

export function toGenerationView(doc: any): GenerationView {
  return {
    id: doc._id.toString(),
    mode: doc.mode,
    prompt: doc.prompt ?? "",
    style: doc.style ?? "none",
    inputImageUrl: doc.inputImageUrl,
    outputImageUrl: doc.outputImageUrl,
    createdAt: new Date(doc.createdAt).toISOString(),
    model3d: toModel3dView(doc.model3d),
    bambu: toBambuView(doc.bambu, doc.model3d?.fileUrl),
  };
}

// modelFileUrl：目前的 3D 檔；跟做 Bambu 檔時用的不一樣，就代表模型之後改過
export function toBambuView(b: any, modelFileUrl: string | undefined): BambuView | undefined {
  if (!b) return undefined;
  return {
    settings: b.settings,
    fileUrl: b.fileUrl,
    fileSizeBytes: b.fileSizeBytes,
    updatedAt: new Date(b.updatedAt).toISOString(),
    outdated: b.sourceFileUrl !== modelFileUrl,
  };
}

export function toBambuUploadView(doc: any): BambuUploadView {
  return {
    id: doc._id.toString(),
    name: doc.name,
    sourceFormat: doc.sourceFormat,
    modelFileUrl: doc.modelFileUrl,
    dimensionsMm: doc.dimensionsMm,
    triangles: doc.triangles,
    pieces: doc.pieces,
    createdAt: new Date(doc.createdAt).toISOString(),
    bambu: toBambuView(doc.bambu, doc.modelFileUrl),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

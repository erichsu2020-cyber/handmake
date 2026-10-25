import type { ModelFormat, ModelSettings } from "@/lib/print-settings";

// 前端看到的資料格式（API 回傳與頁面 props 共用）

export type Model3dView = Partial<ModelSettings> & {
  status: "generating" | "converting" | "uploading" | "done" | "failed";
  progress: number;
  convertTaskId?: string;
  fileUrl?: string;
  format?: ModelFormat;
  dimensionsMm?: [number, number, number];
  triangles?: number;
  fileSizeBytes?: number;
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
};

/* eslint-disable @typescript-eslint/no-explicit-any -- 舊資料欄位不固定，在這裡統一轉換 */
export function toModel3dView(m: any): Model3dView | undefined {
  if (!m) return undefined;
  return {
    ...m,
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
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

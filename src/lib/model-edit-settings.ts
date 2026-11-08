// 「AI 改模型」前後端共用：上傳位置、表單內容、AI 回傳的計畫和結果格式

export const MODEL_EDIT_FOLDER = "handmake/model-edits/";
// 從電腦上傳的 3MF
export const MODEL_EDIT_UPLOAD_FOLDER = `${MODEL_EDIT_FOLDER}uploads/`;
// 瀏覽器拍的模型截圖
export const MODEL_EDIT_SNAPSHOT_FOLDER = `${MODEL_EDIT_FOLDER}snapshots/`;
// 改好的 3MF
export const MODEL_EDIT_OUTPUT_FOLDER = `${MODEL_EDIT_FOLDER}outputs/`;
export const MAX_MODEL_EDIT_UPLOAD_BYTES = 50 * 1024 * 1024;

// keep：不改；exact：使用者指定寬×深×高；ai：讓 AI 依需求說明決定
export type ResizeMode = "keep" | "exact" | "ai";

// 鍵盤軸（Cherry MX 類）的十字孔：模型底部做一個柱座，柱座中間挖母的十字孔，插在軸的十字軸上
export type StemSpec = {
  crossLength: number; // 十字長度（軸的十字，左右／上下的總長）
  crossWidth: number; // 十字臂寬
  clearance: number; // 列印間隙（每邊），孔 = 十字尺寸 + 2 × 間隙
  depth: number; // 孔深
  travel: number; // 按壓行程
  bossDiameter: number; // 柱座外徑
};

// Cherry MX 規格：十字 4.0 × 1.17／1.31 mm、總行程 4.0 mm
export const DEFAULT_STEM: StemSpec = {
  crossLength: 4.0,
  crossWidth: 1.2,
  clearance: 0.1,
  depth: 3.8,
  travel: 4.0,
  bossDiameter: 5.6,
};

export const STEM_FIELDS: { key: keyof StemSpec; label: string; min: number; max: number; step: number; hint?: string }[] = [
  { key: "crossLength", label: "十字長度", min: 2, max: 8, step: 0.05, hint: "MX 是 4.0" },
  { key: "crossWidth", label: "十字臂寬", min: 0.6, max: 3, step: 0.05, hint: "MX 約 1.17–1.31" },
  { key: "clearance", label: "列印間隙（每邊）", min: 0, max: 0.5, step: 0.01, hint: "太緊就加大，0.05–0.15" },
  { key: "depth", label: "孔深", min: 1, max: 8, step: 0.1 },
  { key: "travel", label: "按壓行程", min: 0.5, max: 8, step: 0.1, hint: "MX 是 4.0" },
  { key: "bossDiameter", label: "柱座外徑", min: 4, max: 12, step: 0.1, hint: "MX 鍵帽約 5.5" },
];

// 柱座下面要留的空間：柱座底部靠在軸上，按到底時模型不能撞到軸體上蓋（多留 0.5 mm）
export const stemClearanceHeight = (s: StemSpec) => s.travel + 0.5;
// 底部凹槽的大小：MX 軸體底座約 15.6 mm 見方
export const POCKET_MM = 16.5;
export const POCKET_WALL_MM = 1.6;

export type EditRequest = {
  resize: { mode: ResizeMode; sizeMm?: [number, number, number] };
  stem: StemSpec | null; // null：不加十字孔
  notes: string;
};

const between = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function parseEditRequest(input: unknown): EditRequest | string {
  const r = (input ?? {}) as Partial<EditRequest>;
  const resize = (r.resize ?? {}) as EditRequest["resize"];
  if (!["keep", "exact", "ai"].includes(resize.mode)) return "尺寸選項不正確";
  if (resize.mode === "exact") {
    if (!Array.isArray(resize.sizeMm) || resize.sizeMm.length !== 3 || !resize.sizeMm.every((v) => between(v, 1, 500))) {
      return "尺寸要介於 1–500 mm";
    }
  }
  let stem: StemSpec | null = null;
  if (r.stem) {
    const s = r.stem as Record<string, unknown>;
    for (const f of STEM_FIELDS) {
      if (!between(s[f.key], f.min, f.max)) return `${f.label}要介於 ${f.min}–${f.max} mm`;
    }
    stem = Object.fromEntries(STEM_FIELDS.map((f) => [f.key, s[f.key]])) as StemSpec;
    if (stem.bossDiameter < stem.crossLength + 2 * stem.clearance + 1) return "柱座外徑至少要比十字孔大 1 mm";
  }
  if (typeof r.notes !== "string" || r.notes.length > 1000) return "需求說明不能超過 1000 字";
  if (resize.mode === "ai" && !r.notes.trim()) return "讓 AI 決定尺寸時，請在需求說明寫想要的大小或用途";
  if (resize.mode === "keep" && !stem) return "請至少選一個要修改的項目";
  return { resize: { mode: resize.mode, sizeMm: resize.mode === "exact" ? resize.sizeMm : undefined }, stem, notes: r.notes.trim() };
}

// protrude：柱座從模型底部凸出來；pocket：底部挖凹槽讓軸體退進去（像鍵帽），模型要夠大、底部要平
export type StemMode = "protrude" | "pocket";
export const STEM_MODES: Record<StemMode, string> = {
  protrude: "柱座凸出底部",
  pocket: "底部凹槽（像鍵帽）",
};

export type AiPlan = {
  summary: string;
  targetSizeMm: { width: number; depth: number; height: number };
  sizeReason: string;
  stem: { mode: StemMode; offsetXMm: number; offsetYMm: number; reason: string };
  warnings: string[];
  printAdvice: string[];
};

export type EditResult = {
  plan: AiPlan;
  beforeMm: [number, number, number];
  afterMm: [number, number, number];
  // 實際做出來的十字孔（AI 選的方式做不到時程式會改用另一種，notes 會說明）
  stem?: { mode: StemMode; centerMm: [number, number]; bossLengthMm: number; holeMm: [number, number, number] };
  notes: string[];
  fileUrl: string;
  fileName: string;
};

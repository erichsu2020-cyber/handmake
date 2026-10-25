// 前後端共用的第 2 步設定（Tripo3D 產生模型 + 轉檔）

export const HEIGHT_MM = { min: 10, max: 300, default: 100, presets: [50, 100, 150, 200] };

export const FACE_LIMIT = {
  default: 200_000,
  options: [
    { value: 50_000, label: "5 萬面（檔案最小，細節較少）" },
    { value: 100_000, label: "10 萬面" },
    { value: 200_000, label: "20 萬面（建議）" },
    { value: 500_000, label: "50 萬面（細節最多，檔案較大）" },
  ],
};

export const MODEL_VERSIONS = [
  { value: "v3.1-20260211", label: "v3.1（品質最好，建議）" },
  { value: "v3.0-20250812", label: "v3.0" },
  { value: "v2.5-20250123", label: "v2.5（較舊）" },
  { value: "P1-20260311", label: "P1（低面數造型，不支援細節／零件選項）" },
] as const;

export const FORMATS = [
  { value: "STL", label: "STL（最通用）", ext: "stl", contentType: "model/stl" },
  { value: "3MF", label: "3MF（Bambu／Prusa 建議）", ext: "3mf", contentType: "model/3mf" },
  { value: "OBJ", label: "OBJ（可帶顏色）", ext: "obj", contentType: "model/obj" },
] as const;

export type ModelVersion = (typeof MODEL_VERSIONS)[number]["value"];
export type ModelFormat = (typeof FORMATS)[number]["value"];

// 影響「產生 3D 模型」的設定：改了就要重新產生（扣產生點數）
export type GenerateOptions = {
  modelVersion: ModelVersion;
  geometryQuality: "standard" | "detailed";
  alignToImage: boolean;
  imageAutofix: boolean;
  generateParts: boolean;
  color: boolean;
};

// 只影響「轉檔」的設定：改了只要重新轉檔
export type ConvertOptions = {
  heightMm: number;
  faceLimit: number;
  format: ModelFormat;
  flattenBottom: boolean;
};

export type ModelSettings = GenerateOptions & ConvertOptions;

export const DEFAULT_SETTINGS: ModelSettings = {
  modelVersion: "v3.1-20260211",
  geometryQuality: "standard",
  alignToImage: false,
  imageAutofix: false,
  generateParts: false,
  color: false,
  heightMm: HEIGHT_MM.default,
  faceLimit: FACE_LIMIT.default,
  format: "STL",
  flattenBottom: true,
};

export const isP1 = (version: string) => version.startsWith("P1");

export function sameGenerateOptions(a: Partial<GenerateOptions>, b: GenerateOptions) {
  return (
    a.modelVersion === b.modelVersion &&
    a.geometryQuality === b.geometryQuality &&
    a.alignToImage === b.alignToImage &&
    a.imageAutofix === b.imageAutofix &&
    a.generateParts === b.generateParts &&
    a.color === b.color
  );
}

export function parseModelSettings(input: unknown): ModelSettings | string {
  const s = { ...DEFAULT_SETTINGS, ...((input ?? {}) as Partial<ModelSettings>) };

  if (typeof s.heightMm !== "number" || !Number.isFinite(s.heightMm)) return "請輸入高度";
  if (s.heightMm < HEIGHT_MM.min || s.heightMm > HEIGHT_MM.max) {
    return `高度要介於 ${HEIGHT_MM.min}–${HEIGHT_MM.max} mm`;
  }
  if (!FACE_LIMIT.options.some((o) => o.value === s.faceLimit)) return "面數選項不正確";
  if (!MODEL_VERSIONS.some((v) => v.value === s.modelVersion)) return "模型版本不正確";
  if (!FORMATS.some((f) => f.value === s.format)) return "檔案格式不正確";
  if (!["standard", "detailed"].includes(s.geometryQuality)) return "幾何細節選項不正確";
  for (const key of ["alignToImage", "imageAutofix", "generateParts", "color", "flattenBottom"] as const) {
    if (typeof s[key] !== "boolean") return `${key} 必須是 true 或 false`;
  }

  // 互斥規則
  if (s.color && s.generateParts) return "彩色模型與拆零件不能同時開啟";
  if (s.color && s.format !== "OBJ") return "彩色模型只有 OBJ 格式能保留顏色";
  if (isP1(s.modelVersion) && (s.generateParts || s.geometryQuality !== "standard")) {
    return "P1 版本不支援拆零件與精細幾何";
  }

  return s;
}

// 前後端共用的第 2 步設定
// 分成四層，改到哪一層就從哪一步重做（越後面越省點數）：
//   產生模型 → 外觀材質（重新上貼圖）→ Tripo 轉檔 → 本機處理（尺寸、切開、空心化，不扣點數）

export const SIZE_RANGE = { min: 5, max: 500 };
export const SIZE_PRESETS = [50, 100, 150, 200];

export const BED_PRESETS = [
  { label: "Bambu A1 mini", x: 180, y: 180, z: 180 },
  { label: "Bambu A1／P1／X1", x: 256, y: 256, z: 256 },
  { label: "Prusa MK4", x: 250, y: 210, z: 220 },
  { label: "Ender 3", x: 220, y: 220, z: 250 },
];

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
  { value: "P1-20260311", label: "P1（低面數造型，不支援細節／零件／切開／空心化）" },
] as const;

export const FORMATS = [
  { value: "STL", label: "STL（最通用）", ext: "stl", contentType: "model/stl" },
  { value: "3MF", label: "3MF（Bambu／Prusa 建議）", ext: "3mf", contentType: "model/3mf" },
  { value: "OBJ", label: "OBJ（可帶顏色）", ext: "obj", contentType: "model/obj" },
] as const;

// 外觀材質：用 Tripo 重新上貼圖（只在彩色模型時有效）
export const APPEARANCE_MATERIALS = [
  { value: "none", label: "照原圖", prompt: "" },
  { value: "wood", label: "木頭", prompt: "hand-carved natural wood with visible grain" },
  { value: "metal", label: "金屬", prompt: "brushed metal with subtle reflections" },
  { value: "bronze", label: "青銅", prompt: "aged bronze statue with patina" },
  { value: "marble", label: "大理石", prompt: "polished white marble with gray veins" },
  { value: "ceramic", label: "陶瓷", prompt: "glazed ceramic" },
  { value: "stone", label: "石材", prompt: "rough carved stone" },
  { value: "plastic", label: "亮面塑膠", prompt: "glossy colorful plastic toy" },
] as const;

export type ModelVersion = (typeof MODEL_VERSIONS)[number]["value"];
export type ModelFormat = (typeof FORMATS)[number]["value"];
export type AppearanceMaterial = (typeof APPEARANCE_MATERIALS)[number]["value"];
export type SizeMode = "axis" | "fit" | "xyz";
export type SizeAxis = "height" | "width" | "depth";

// 1. 產生模型（改了要重新產生）
export type GenerateOptions = {
  modelVersion: ModelVersion;
  geometryQuality: "standard" | "detailed";
  alignToImage: boolean;
  imageAutofix: boolean;
  generateParts: boolean;
  color: boolean;
};

// 2. 外觀材質（改了要重新上貼圖）
export type TextureOptions = { appearance: AppearanceMaterial };

// 3. Tripo 轉檔
export type ConvertOptions = {
  faceLimit: number;
  format: ModelFormat;
  flattenBottom: boolean;
};

// 4. 本機處理（不扣點數）
export type ProcessOptions = {
  sizeMode: SizeMode;
  sizeAxis: SizeAxis;
  sizeMm: number;
  bedX: number;
  bedY: number;
  bedZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  trimBottomMm: number; // 0 = 不切
  cutAtPercent: number; // 0 = 不切開，否則在高度的幾 % 切成上下兩塊
  hollowWallMm: number; // 0 = 實心
  drainHole: boolean;
};

export type ModelSettings = GenerateOptions & TextureOptions & ConvertOptions & ProcessOptions;

export const DEFAULT_SETTINGS: ModelSettings = {
  modelVersion: "v3.1-20260211",
  geometryQuality: "standard",
  alignToImage: false,
  imageAutofix: false,
  generateParts: false,
  color: false,
  appearance: "none",
  faceLimit: FACE_LIMIT.default,
  format: "STL",
  flattenBottom: true,
  sizeMode: "axis",
  sizeAxis: "height",
  sizeMm: 100,
  bedX: 256,
  bedY: 256,
  bedZ: 256,
  sizeX: 80,
  sizeY: 80,
  sizeZ: 100,
  trimBottomMm: 0,
  cutAtPercent: 0,
  hollowWallMm: 0,
  drainHole: false,
};

export const GENERATE_KEYS = [
  "modelVersion",
  "geometryQuality",
  "alignToImage",
  "imageAutofix",
  "generateParts",
  "color",
] as const satisfies readonly (keyof GenerateOptions)[];
export const CONVERT_KEYS = ["faceLimit", "format", "flattenBottom"] as const satisfies readonly (keyof ConvertOptions)[];

export const isP1 = (version: string) => version.startsWith("P1");

const sameKeys = <T extends object>(a: Partial<T>, b: T, keys: readonly (keyof T)[]) =>
  keys.every((key) => a[key] === b[key]);

export const sameGenerateOptions = (a: Partial<ModelSettings>, b: ModelSettings) =>
  sameKeys(a, b, GENERATE_KEYS);
// 沒開彩色時外觀材質沒有作用，視為相同
export const sameTextureOptions = (a: Partial<ModelSettings>, b: ModelSettings) =>
  !b.color || (a.appearance ?? "none") === b.appearance;
export const sameConvertOptions = (a: Partial<ModelSettings>, b: ModelSettings) =>
  sameKeys(a, b, CONVERT_KEYS);

// 切開、空心化需要封閉網格：拆零件、P1、彩色 OBJ 都不支援
export const canUseMeshOps = (s: Pick<ModelSettings, "generateParts" | "modelVersion" | "format">) =>
  !s.generateParts && !isP1(s.modelVersion) && s.format !== "OBJ";

// 舊資料只有 heightMm
export function migrateSettings(m: Record<string, unknown>): Partial<ModelSettings> {
  if (m.sizeMm === undefined && typeof m.heightMm === "number") {
    return { ...m, sizeMode: "axis", sizeAxis: "height", sizeMm: m.heightMm } as Partial<ModelSettings>;
  }
  return m as Partial<ModelSettings>;
}

const inRange = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function parseModelSettings(input: unknown): ModelSettings | string {
  const s = { ...DEFAULT_SETTINGS, ...((input ?? {}) as Partial<ModelSettings>) };
  const { min, max } = SIZE_RANGE;

  if (!MODEL_VERSIONS.some((v) => v.value === s.modelVersion)) return "模型版本不正確";
  if (!["standard", "detailed"].includes(s.geometryQuality)) return "幾何細節選項不正確";
  if (!APPEARANCE_MATERIALS.some((m) => m.value === s.appearance)) return "外觀材質選項不正確";
  if (!FACE_LIMIT.options.some((o) => o.value === s.faceLimit)) return "面數選項不正確";
  if (!FORMATS.some((f) => f.value === s.format)) return "檔案格式不正確";
  for (const key of ["alignToImage", "imageAutofix", "generateParts", "color", "flattenBottom", "drainHole"] as const) {
    if (typeof s[key] !== "boolean") return `${key} 必須是 true 或 false`;
  }

  if (!["axis", "fit", "xyz"].includes(s.sizeMode)) return "尺寸模式不正確";
  if (!["height", "width", "depth"].includes(s.sizeAxis)) return "尺寸方向不正確";
  if (s.sizeMode === "axis" && !inRange(s.sizeMm, min, max)) return `尺寸要介於 ${min}–${max} mm`;
  if (s.sizeMode === "fit" && ![s.bedX, s.bedY, s.bedZ].every((v) => inRange(v, min, max))) {
    return `列印平台尺寸要介於 ${min}–${max} mm`;
  }
  if (s.sizeMode === "xyz" && ![s.sizeX, s.sizeY, s.sizeZ].every((v) => inRange(v, min, max))) {
    return `長寬高要介於 ${min}–${max} mm`;
  }
  if (!inRange(s.trimBottomMm, 0, 50)) return "底部切除要介於 0–50 mm";
  if (!(s.cutAtPercent === 0 || inRange(s.cutAtPercent, 10, 90))) return "切開位置要介於 10–90%";
  if (!(s.hollowWallMm === 0 || inRange(s.hollowWallMm, 1, 10))) return "空心壁厚要介於 1–10 mm";

  // 互斥規則
  if (s.color && s.generateParts) return "彩色模型與拆零件不能同時開啟";
  if (s.color && s.format !== "OBJ") return "彩色模型只有 OBJ 格式能保留顏色";
  if (!s.color && s.appearance !== "none") return "外觀材質需要開啟彩色模型";
  if (isP1(s.modelVersion) && (s.generateParts || s.geometryQuality !== "standard")) {
    return "P1 版本不支援拆零件與精細幾何";
  }
  if (!canUseMeshOps(s) && (s.trimBottomMm > 0 || s.cutAtPercent > 0 || s.hollowWallMm > 0)) {
    return "拆零件、P1 版本或彩色 OBJ 的模型不能切開或空心化";
  }
  if (s.drainHole && s.hollowWallMm === 0) return "排液孔需要先開啟空心化";

  return s;
}

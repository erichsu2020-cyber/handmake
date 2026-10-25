// 前後端共用的列印設定範圍
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

export type PrintSettings = { heightMm: number; faceLimit: number };

export function parsePrintSettings(input: unknown): PrintSettings | string {
  const { heightMm, faceLimit } = (input ?? {}) as Record<string, unknown>;

  if (typeof heightMm !== "number" || !Number.isFinite(heightMm)) return "請輸入高度";
  if (heightMm < HEIGHT_MM.min || heightMm > HEIGHT_MM.max) {
    return `高度要介於 ${HEIGHT_MM.min}–${HEIGHT_MM.max} mm`;
  }
  if (!FACE_LIMIT.options.some((o) => o.value === faceLimit)) return "面數選項不正確";

  return { heightMm, faceLimit: faceLimit as number };
}

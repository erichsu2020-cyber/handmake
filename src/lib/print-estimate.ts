// 列印耗材與切片參數的粗估（純前端計算，改參數不需要重新產生檔案）
// 只是估算，實際以切片軟體（Bambu Studio、Cura、PrusaSlicer…）的結果為準

export type MeshStats = {
  volumeMm3: number;
  surfaceAreaMm2: number;
  // 懸空面（朝下超過 45°）底下到平台的體積，用來估算支撐
  overhangVolumeMm3: number;
  overhangAreaMm2: number;
};

export const PRINT_MATERIALS = [
  { value: "PLA", label: "PLA（最好印）", density: 1.24, pricePerKg: 600, kind: "fdm" },
  { value: "PETG", label: "PETG（較耐熱、韌）", density: 1.27, pricePerKg: 650, kind: "fdm" },
  { value: "ABS", label: "ABS（耐熱，需封箱）", density: 1.04, pricePerKg: 650, kind: "fdm" },
  { value: "TPU", label: "TPU（軟膠）", density: 1.21, pricePerKg: 900, kind: "fdm" },
  { value: "RESIN", label: "光固化樹脂", density: 1.1, pricePerKg: 1200, kind: "resin" },
] as const;

export type PrintMaterial = (typeof PRINT_MATERIALS)[number]["value"];

export const SUPPORT_OPTIONS = [
  { value: "none", label: "不加支撐" },
  { value: "normal", label: "一般支撐" },
  { value: "tree", label: "樹狀支撐（較省料、好拆）" },
] as const;

export type SliceSettings = {
  material: PrintMaterial;
  layerHeight: number;
  infillPercent: number;
  wallLoops: number;
  support: (typeof SUPPORT_OPTIONS)[number]["value"];
  pricePerKg: number;
};

export const DEFAULT_SLICE: SliceSettings = {
  material: "PLA",
  layerHeight: 0.2,
  infillPercent: 15,
  wallLoops: 2,
  support: "tree",
  pricePerKg: 600,
};

export const LAYER_HEIGHTS = {
  fdm: [0.08, 0.12, 0.16, 0.2, 0.24, 0.28],
  resin: [0.025, 0.05, 0.1],
};

const LINE_WIDTH_MM = 0.42;
const SUPPORT_FILL = { none: 0, normal: 0.15, tree: 0.08 };

export type PrintEstimate = {
  grams: number;
  cost: number;
  hours: number;
  supportGrams: number;
  // 懸空面積佔總表面積的比例，超過一定比例建議加支撐
  overhangRatio: number;
  supportRecommended: boolean;
};

export function estimatePrint(stats: MeshStats, heightMm: number, s: SliceSettings): PrintEstimate {
  const material = PRINT_MATERIALS.find((m) => m.value === s.material) ?? PRINT_MATERIALS[0];
  const overhangRatio = stats.surfaceAreaMm2 > 0 ? stats.overhangAreaMm2 / stats.surfaceAreaMm2 : 0;
  const supportVolume = stats.overhangVolumeMm3 * SUPPORT_FILL[s.support];

  let partVolume: number;
  let hours: number;
  if (material.kind === "resin") {
    // 樹脂：整個實體都是材料；每層約 7 秒（曝光 + 抬升）
    partVolume = stats.volumeMm3;
    hours = ((heightMm / s.layerHeight) * 7) / 3600;
  } else {
    // FDM：外殼（表面積 × 壁厚）+ 內部填充
    const shell = Math.min(stats.volumeMm3, stats.surfaceAreaMm2 * s.wallLoops * LINE_WIDTH_MM);
    const infill = Math.max(0, stats.volumeMm3 - shell) * (s.infillPercent / 100);
    partVolume = shell + infill;
    // 一般印表機約 10 mm³/s（0.2mm 層高），層越薄越慢；再加 30% 移動與換層時間
    const flow = 10 * (s.layerHeight / 0.2);
    hours = (((partVolume + supportVolume) / flow) * 1.3) / 3600;
  }

  const gramsPerMm3 = material.density / 1000;
  const grams = (partVolume + supportVolume) * gramsPerMm3;

  return {
    grams,
    cost: (grams / 1000) * s.pricePerKg,
    hours,
    supportGrams: supportVolume * gramsPerMm3,
    overhangRatio,
    supportRecommended: overhangRatio > 0.05,
  };
}

// 給切片軟體參考的設定文字
export function sliceSummary(s: SliceSettings) {
  const material = PRINT_MATERIALS.find((m) => m.value === s.material) ?? PRINT_MATERIALS[0];
  const support = SUPPORT_OPTIONS.find((o) => o.value === s.support)?.label ?? s.support;
  if (material.kind === "resin") {
    return [`材料：${material.label}`, `層高：${s.layerHeight} mm`, `支撐：${support}`].join("\n");
  }
  return [
    `材料：${material.label}`,
    `層高：${s.layerHeight} mm`,
    `牆壁圈數：${s.wallLoops}（約 ${(s.wallLoops * LINE_WIDTH_MM).toFixed(2)} mm）`,
    `填充密度：${s.infillPercent}%`,
    `支撐：${support}`,
  ].join("\n");
}

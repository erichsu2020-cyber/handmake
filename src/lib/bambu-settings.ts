import catalog from "@/data/bambu-catalog.json";

// 前後端共用的 Bambu Studio 列印設定：寫進 3MF 的 project_settings.config，
// 用 Bambu Studio 打開就會自動套用。印表機與線材清單來自 scripts/bambu-profiles.mts

export type BambuPrinter = (typeof catalog.printers)[number];
export type BambuNozzle = BambuPrinter["nozzles"][number];
export type BambuFilament = BambuNozzle["filaments"][number];

// 第一個是預設印表機（H2S）
export const BAMBU_PRINTERS: BambuPrinter[] = catalog.printers;
export const DEFAULT_NOZZLE = 0.4;
export const BAMBU_PROFILE_VERSION = catalog.version;

export const PLATES = [
  { value: "textured", label: "紋理 PEI 板", bedType: "Textured PEI Plate" },
  { value: "smooth", label: "光滑 PEI 板／高溫板", bedType: "High Temp Plate" },
  { value: "cool", label: "低溫板", bedType: "Cool Plate" },
] as const;

export const INFILL_PATTERNS = [
  { value: "grid", label: "網格" },
  { value: "gyroid", label: "螺旋（Gyroid）" },
  { value: "cubic", label: "立方" },
  { value: "honeycomb", label: "蜂巢" },
  { value: "triangles", label: "三角形" },
  { value: "lightning", label: "閃電（只撐頂面，最省料）" },
] as const;

export const SUPPORT_TYPES = [
  { value: "tree(auto)", label: "樹狀（自動）" },
  { value: "normal(auto)", label: "一般（自動）" },
] as const;

export const BRIM_TYPES = [
  { value: "auto_brim", label: "自動" },
  { value: "outer_only", label: "僅外側" },
  { value: "no_brim", label: "無" },
] as const;

// 需要硬化鋼噴嘴的線材
export const ABRASIVE_FILAMENTS = ["PETG-CF"];

export type PlateType = (typeof PLATES)[number]["value"];
export type InfillPattern = (typeof INFILL_PATTERNS)[number]["value"];
export type SupportType = (typeof SUPPORT_TYPES)[number]["value"];
export type BrimType = (typeof BRIM_TYPES)[number]["value"];

export type BambuSettings = {
  printer: string;
  nozzle: number; // 噴嘴直徑（mm）
  filament: string;
  plate: PlateType;
  layerHeight: number;
  wallLoops: number;
  topLayers: number;
  bottomLayers: number;
  infillDensity: number; // %
  infillPattern: InfillPattern;
  support: boolean;
  supportType: SupportType;
  supportAngle: number; // 懸垂角度門檻（度），0 = 交給 Bambu Studio 自動判斷
  brim: BrimType;
  nozzleTemp: number;
  bedTemp: number;
};

type QualityKeys = "layerHeight" | "wallLoops" | "topLayers" | "bottomLayers" | "infillDensity" | "infillPattern";

export const QUICK_PRESETS: { value: string; label: string; settings: Pick<BambuSettings, QualityKeys> }[] = [
  {
    value: "draft",
    label: "草稿（最快）",
    settings: { layerHeight: 0.28, wallLoops: 2, topLayers: 3, bottomLayers: 3, infillDensity: 10, infillPattern: "grid" },
  },
  {
    value: "standard",
    label: "標準",
    settings: { layerHeight: 0.2, wallLoops: 2, topLayers: 5, bottomLayers: 3, infillDensity: 15, infillPattern: "grid" },
  },
  {
    value: "fine",
    label: "精細",
    settings: { layerHeight: 0.12, wallLoops: 3, topLayers: 7, bottomLayers: 5, infillDensity: 15, infillPattern: "gyroid" },
  },
  {
    value: "strong",
    label: "堅固",
    settings: { layerHeight: 0.2, wallLoops: 4, topLayers: 6, bottomLayers: 4, infillDensity: 30, infillPattern: "gyroid" },
  },
];

export const findPrinter = (id: string) => BAMBU_PRINTERS.find((p) => p.id === id);
export const findNozzle = (printer: BambuPrinter, diameter: number) => printer.nozzles.find((n) => n.diameter === diameter);
export const findFilament = (nozzle: BambuNozzle, id: string) => nozzle.filaments.find((f) => f.id === id);

// 依設定找出印表機＋噴嘴，找不到回傳 null
export function findSetup(s: Pick<BambuSettings, "printer" | "nozzle">) {
  const printer = findPrinter(s.printer);
  const nozzle = printer && findNozzle(printer, s.nozzle);
  return printer && nozzle ? { printer, nozzle } : null;
}

// 噴嘴沒有這個層高時（例如 0.6 噴嘴沒有 0.20），用最接近的
export const nearestLayerHeight = (nozzle: BambuNozzle, layerHeight: number) =>
  nozzle.layerHeights.reduce((best, h) => (Math.abs(h - layerHeight) < Math.abs(best - layerHeight) ? h : best));

// 套用快速預設：品質相關的欄位換掉，印表機、線材、溫度、支撐不動
export function applyQuickPreset(settings: BambuSettings, presetValue: string): BambuSettings {
  const preset = QUICK_PRESETS.find((p) => p.value === presetValue);
  const setup = findSetup(settings);
  if (!preset || !setup) return settings;
  return {
    ...settings,
    ...preset.settings,
    layerHeight: nearestLayerHeight(setup.nozzle, preset.settings.layerHeight),
  };
}

// 換印表機、噴嘴、線材或列印板時，溫度改回官方建議值
export function withDefaultTemps(settings: BambuSettings): BambuSettings {
  const setup = findSetup(settings);
  const filament = setup && findFilament(setup.nozzle, settings.filament);
  if (!filament) return settings;
  return { ...settings, nozzleTemp: filament.nozzleTemp, bedTemp: filament.bedTemp[settings.plate] };
}

export const DEFAULT_BAMBU_SETTINGS: BambuSettings = withDefaultTemps({
  printer: BAMBU_PRINTERS[0].id,
  nozzle: DEFAULT_NOZZLE,
  filament: "PLA Basic",
  plate: "textured",
  ...QUICK_PRESETS[1].settings,
  support: false,
  supportType: "tree(auto)",
  supportAngle: 30,
  brim: "auto_brim",
  nozzleTemp: 0,
  bedTemp: 0,
});

const isInt = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function parseBambuSettings(input: unknown): BambuSettings | string {
  const s = { ...DEFAULT_BAMBU_SETTINGS, ...((input ?? {}) as Partial<BambuSettings>) };

  const printer = findPrinter(s.printer);
  if (!printer) return "印表機選項不正確";
  const nozzle = findNozzle(printer, s.nozzle);
  if (!nozzle) return `${printer.label} 沒有 ${s.nozzle} mm 噴嘴的官方設定`;
  const filament = findFilament(nozzle, s.filament);
  if (!filament) return `${printer.label} ${s.nozzle} mm 噴嘴沒有 ${s.filament} 的官方設定`;
  if (!PLATES.some((p) => p.value === s.plate)) return "列印板選項不正確";
  if (filament.bedTemp[s.plate] === 0) return `${s.filament} 不建議用這種列印板`;

  if (!nozzle.layerHeights.includes(s.layerHeight)) {
    return `${s.nozzle} mm 噴嘴的層高只能選 ${nozzle.layerHeights.join("、")} mm`;
  }
  if (!isInt(s.wallLoops, 1, 10)) return "牆數要介於 1–10";
  if (!isInt(s.topLayers, 0, 30)) return "頂層數要介於 0–30";
  if (!isInt(s.bottomLayers, 0, 30)) return "底層數要介於 0–30";
  if (!isInt(s.infillDensity, 0, 100)) return "填充密度要介於 0–100%";
  if (!INFILL_PATTERNS.some((p) => p.value === s.infillPattern)) return "填充圖案不正確";

  if (typeof s.support !== "boolean") return "support 必須是 true 或 false";
  if (!SUPPORT_TYPES.some((t) => t.value === s.supportType)) return "支撐類型不正確";
  if (!isInt(s.supportAngle, 0, 90)) return "懸垂角度要介於 0–90 度";
  if (!BRIM_TYPES.some((b) => b.value === s.brim)) return "Brim 選項不正確";

  const [low, high] = filament.nozzleRange;
  if (!isInt(s.nozzleTemp, low, high)) return `${s.filament} 的噴嘴溫度要介於 ${low}–${high}°C`;
  if (!isInt(s.bedTemp, 0, 110)) return "熱床溫度要介於 0–110°C";

  return s;
}

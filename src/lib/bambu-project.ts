import "server-only";
import { strToU8, zipSync } from "fflate";
import { readBambuProject, type BambuProject, type Config } from "@/lib/bambu-project-read";
import { boundsSize, meshBounds, meshStats, type MeshData } from "@/lib/mesh";
import { estimatePrint, PRINT_MATERIALS, type PrintEstimate } from "@/lib/print-estimate";

// 「AI 列印檢查」的伺服器端分析（讀檔在 bambu-project-read.ts，瀏覽器也會用）：
//   1. 設定摘要：Metadata/project_settings.config（JSON）裡跟列印品質有關的欄位
//   2. 修改設定：只改白名單裡的欄位，其他內容（模型、盤、切片預覽…）原封不動
//   3. 幾何分析與成本粗估

export { readBambuProject, type BambuProject };

// ---------- 設定 ----------

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const num = (v: unknown) => Number(first(v));

type SettingDef = {
  key: string;
  label: string;
  group: "process" | "filament" | "machine";
  unit?: string;
  // 可以被 AI 修改；沒有的話只是給 AI 參考
  edit?: { kind: "int" | "float" | "percent" | "bool" | "enum"; min?: number; max?: number; options?: string[] };
};

// 列印板 → 熱床溫度欄位；AI 只要說「熱床溫度」，這裡換成目前列印板的欄位
const PLATE_TEMP_KEY: Record<string, string> = {
  "Textured PEI Plate": "textured_plate_temp",
  "High Temp Plate": "hot_plate_temp",
  "Cool Plate": "cool_plate_temp",
  "Engineering Plate": "eng_plate_temp",
  "Supertack Plate": "supertack_plate_temp",
};

export const SETTING_DEFS: SettingDef[] = [
  { key: "printer_settings_id", label: "印表機", group: "machine" },
  { key: "nozzle_diameter", label: "噴嘴口徑", group: "machine", unit: "mm" },
  { key: "curr_bed_type", label: "列印板", group: "machine" },
  { key: "print_settings_id", label: "品質預設", group: "process" },
  { key: "filament_settings_id", label: "線材預設", group: "filament" },
  { key: "filament_type", label: "線材種類", group: "filament" },
  { key: "nozzle_temperature_range_low", label: "噴嘴溫度下限", group: "filament", unit: "°C" },
  { key: "nozzle_temperature_range_high", label: "噴嘴溫度上限", group: "filament", unit: "°C" },
  { key: "filament_max_volumetric_speed", label: "最大體積流量", group: "filament", unit: "mm³/s" },

  { key: "layer_height", label: "層高", group: "process", unit: "mm", edit: { kind: "float", min: 0.04, max: 0.8 } },
  { key: "initial_layer_print_height", label: "首層層高", group: "process", unit: "mm", edit: { kind: "float", min: 0.08, max: 0.8 } },
  { key: "wall_loops", label: "牆數", group: "process", edit: { kind: "int", min: 1, max: 20 } },
  { key: "top_shell_layers", label: "頂層數", group: "process", edit: { kind: "int", min: 0, max: 50 } },
  { key: "bottom_shell_layers", label: "底層數", group: "process", edit: { kind: "int", min: 0, max: 50 } },
  // 設定值本身就帶 %（例如 "15%"），不另外加單位
  { key: "sparse_infill_density", label: "填充密度", group: "process", edit: { kind: "percent", min: 0, max: 100 } },
  {
    key: "sparse_infill_pattern",
    label: "填充圖案",
    group: "process",
    edit: { kind: "enum", options: ["grid", "gyroid", "cubic", "honeycomb", "triangles", "lightning", "line", "adaptivecubic", "zig-zag"] },
  },
  { key: "enable_support", label: "開啟支撐", group: "process", edit: { kind: "bool" } },
  { key: "support_type", label: "支撐類型", group: "process", edit: { kind: "enum", options: ["tree(auto)", "normal(auto)"] } },
  { key: "support_threshold_angle", label: "支撐角度門檻", group: "process", unit: "°", edit: { kind: "int", min: 0, max: 90 } },
  {
    key: "brim_type",
    label: "Brim",
    group: "process",
    edit: { kind: "enum", options: ["auto_brim", "outer_only", "inner_only", "outer_and_inner", "no_brim"] },
  },
  { key: "brim_width", label: "Brim 寬度", group: "process", unit: "mm", edit: { kind: "float", min: 0, max: 30 } },
  { key: "ironing_type", label: "熨燙", group: "process", edit: { kind: "enum", options: ["no ironing", "top", "topmost", "solid"] } },
  { key: "seam_position", label: "接縫位置", group: "process", edit: { kind: "enum", options: ["aligned", "nearest", "back", "random"] } },
  { key: "outer_wall_speed", label: "外牆速度", group: "process", unit: "mm/s", edit: { kind: "float", min: 10, max: 1000 } },
  { key: "inner_wall_speed", label: "內牆速度", group: "process", unit: "mm/s", edit: { kind: "float", min: 10, max: 1000 } },
  { key: "sparse_infill_speed", label: "填充速度", group: "process", unit: "mm/s", edit: { kind: "float", min: 10, max: 1000 } },
  { key: "top_surface_speed", label: "頂面速度", group: "process", unit: "mm/s", edit: { kind: "float", min: 10, max: 1000 } },
  { key: "initial_layer_speed", label: "首層速度", group: "process", unit: "mm/s", edit: { kind: "float", min: 5, max: 500 } },

  { key: "nozzle_temperature", label: "噴嘴溫度", group: "filament", unit: "°C", edit: { kind: "int", min: 150, max: 350 } },
  { key: "nozzle_temperature_initial_layer", label: "首層噴嘴溫度", group: "filament", unit: "°C", edit: { kind: "int", min: 150, max: 350 } },
  // 虛擬欄位：對應到目前列印板的熱床溫度
  { key: "bed_temperature", label: "熱床溫度", group: "filament", unit: "°C", edit: { kind: "int", min: 0, max: 120 } },
  { key: "bed_temperature_initial_layer", label: "首層熱床溫度", group: "filament", unit: "°C", edit: { kind: "int", min: 0, max: 120 } },
];

export const EDITABLE_KEYS = SETTING_DEFS.filter((d) => d.edit).map((d) => d.key);

// 虛擬欄位 → 設定檔裡真正的欄位
function realKey(config: Config, key: string) {
  if (key === "bed_temperature" || key === "bed_temperature_initial_layer") {
    const plateKey = PLATE_TEMP_KEY[String(first(config.curr_bed_type))] ?? "textured_plate_temp";
    return key === "bed_temperature" ? plateKey : `${plateKey}_initial_layer`;
  }
  return key;
}

export type SettingRow = { key: string; label: string; value: string; unit?: string; editable: boolean };

export function summarizeSettings(config: Config): SettingRow[] {
  return SETTING_DEFS.flatMap((d) => {
    const raw = config[realKey(config, d.key)];
    if (raw === undefined) return [];
    const value = Array.isArray(raw) ? raw.join("、") : String(raw);
    return [{ key: d.key, label: d.label, value, unit: d.unit, editable: Boolean(d.edit) }];
  });
}

// 數值欄位在這個專案裡實際允許的範圍：層高受噴嘴限制、噴嘴溫度不能超出線材的建議範圍
function effectiveRange(config: Config, def: SettingDef) {
  let min = def.edit?.min ?? -Infinity;
  let max = def.edit?.max ?? Infinity;
  if (def.key === "layer_height") {
    min = Math.max(min, num(config.min_layer_height) || 0);
    max = Math.min(max, num(config.max_layer_height) || num(config.nozzle_diameter) * 0.75 || max);
  }
  if (def.key.startsWith("nozzle_temperature")) {
    min = Math.max(min, num(config.nozzle_temperature_range_low) || min);
    max = Math.min(max, num(config.nozzle_temperature_range_high) || max);
  }
  return { min, max };
}

export type EditableSpec = {
  key: string;
  label: string;
  unit?: string;
  kind: NonNullable<SettingDef["edit"]>["kind"];
  min?: number;
  max?: number;
  options?: string[];
  current?: string;
};

// 告訴 AI 可以改哪些設定、每個允許填什麼值（跟 applySettingChanges 的檢查是同一套規則）
export function editableSpecs(config: Config): EditableSpec[] {
  return SETTING_DEFS.filter((d) => d.edit).map((d) => {
    const { min, max } = effectiveRange(config, d);
    const raw = config[realKey(config, d.key)];
    return {
      key: d.key,
      label: d.label,
      unit: d.unit,
      kind: d.edit!.kind,
      ...(Number.isFinite(min) ? { min } : {}),
      ...(Number.isFinite(max) ? { max } : {}),
      ...(d.edit!.options ? { options: d.edit!.options } : {}),
      ...(raw !== undefined ? { current: String(first(raw)) } : {}),
    };
  });
}

// 驗證並轉成設定檔裡的字串；不合法回傳 { error }
function normalizeValue(config: Config, def: SettingDef, value: unknown): { value: string } | { error: string } {
  const edit = def.edit!;
  if (edit.kind === "bool") {
    const v = value === true || value === "1" || value === 1 || value === "true";
    const off = value === false || value === "0" || value === 0 || value === "false";
    return v || off ? { value: v ? "1" : "0" } : { error: "必須是開或關" };
  }
  if (edit.kind === "enum") {
    return edit.options!.includes(String(value)) ? { value: String(value) } : { error: `只能是 ${edit.options!.join("、")}` };
  }
  const n = Number(String(value).replace("%", ""));
  if (!Number.isFinite(n)) return { error: "必須是數字" };
  if (edit.kind === "int" && !Number.isInteger(n)) return { error: "必須是整數" };
  const { min, max } = effectiveRange(config, def);
  if (n < min || n > max) return { error: `要介於 ${min}–${max}${def.unit ?? ""}` };
  return { value: edit.kind === "percent" ? `${n}%` : String(n) };
}

export type SettingChange = { key: string; value: string | number | boolean };
export type AppliedChange = { key: string; label: string; from: string; to: string };
export type RejectedChange = { key: string; value: string; reason: string };

// 依照白名單修改設定，回傳新的 3MF；模型、盤面、縮圖等其他內容不動
export function applySettingChanges(project: BambuProject, changes: SettingChange[]) {
  if (!project.config) throw new Error("這個 3MF 沒有 Bambu Studio 設定，無法修改");
  const config: Config = structuredClone(project.config);
  const applied: AppliedChange[] = [];
  const rejected: RejectedChange[] = [];
  const filamentCount = Array.isArray(config.filament_type) ? config.filament_type.length : 1;
  const mixedFilaments = Array.isArray(config.filament_type) && new Set(config.filament_type).size > 1;
  const changedKeys = { process: new Set<string>(), filament: new Set<string>() };

  for (const change of changes) {
    const def = SETTING_DEFS.find((d) => d.key === change.key);
    if (!def?.edit) {
      rejected.push({ key: change.key, value: String(change.value), reason: "這個設定不能自動修改" });
      continue;
    }
    if (def.group === "filament" && mixedFilaments) {
      rejected.push({ key: change.key, value: String(change.value), reason: "專案用了多種線材，溫度要在 Bambu Studio 個別調整" });
      continue;
    }
    const normalized = normalizeValue(config, def, change.value);
    if ("error" in normalized) {
      rejected.push({ key: change.key, value: String(change.value), reason: normalized.error });
      continue;
    }
    const key = realKey(config, def.key);
    const current = config[key];
    const from = current === undefined ? "（預設）" : String(first(current));
    if (from === normalized.value) continue;
    // 陣列（多個線材、依噴嘴類型分組）每個值都換掉；線材設定沒有這個欄位時，依線材數量建立
    config[key] = Array.isArray(current)
      ? current.map(() => normalized.value)
      : def.group === "filament"
        ? Array(filamentCount).fill(normalized.value)
        : normalized.value;
    applied.push({ key: def.key, label: def.label, from, to: normalized.value });
    changedKeys[def.group === "filament" ? "filament" : "process"].add(key);
  }

  // Bambu Studio 用 different_settings_to_system 標示「已修改」：[品質, 線材 1…n, 印表機]
  const diff = Array.isArray(config.different_settings_to_system) ? [...(config.different_settings_to_system as string[])] : [];
  if (diff.length >= 2) {
    const add = (index: number, keys: Set<string>) => {
      const set = new Set(String(diff[index] ?? "").split(";").filter(Boolean));
      keys.forEach((k) => set.add(k));
      diff[index] = [...set].join(";");
    };
    add(0, changedKeys.process);
    for (let i = 1; i < diff.length - 1; i++) add(i, changedKeys.filament);
    config.different_settings_to_system = diff;
  }

  const buffer = Buffer.from(
    zipSync({ ...project.files, "Metadata/project_settings.config": strToU8(JSON.stringify(config, null, 4)) }),
  );
  return { buffer, applied, rejected, config };
}

// ---------- 幾何分析 ----------

export type GeometryReport = {
  sizeMm: [number, number, number];
  objects: number;
  triangles: number;
  volumeCm3: number;
  surfaceAreaCm2: number;
  overhangAreaCm2: number;
  overhangRatio: number; // 懸空面積 ÷ 表面積
  baseContactAreaMm2: number; // 貼在平台上的面積
  heightToBase: number; // 高度 ÷ 底面等效寬度，越大越容易倒
  floatingMm: number; // 最低點離平台多高（> 0 代表沒貼平台）
  openEdges: number; // 網格破洞的邊數（0 代表封閉）
  nonManifoldEdges: number; // 被三個以上三角形共用的邊（模型錯誤）
  bedMm?: [number, number, number];
  fitsBed?: boolean;
};

// 網格是否封閉：把位置相同的頂點合併後，每條邊應該剛好被兩個三角形共用
function edgeCheck(mesh: MeshData) {
  const p = mesh.positions;
  const ids = new Map<string, number>();
  const vertexId = new Uint32Array(p.length / 3);
  for (let v = 0; v < vertexId.length; v++) {
    const key = `${p[v * 3].toFixed(3)},${p[v * 3 + 1].toFixed(3)},${p[v * 3 + 2].toFixed(3)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    vertexId[v] = id;
  }
  const n = ids.size;
  const edges = new Map<number, number>();
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const [x, y] = [vertexId[a], vertexId[b]];
      if (x === y) continue;
      const key = x < y ? x * n + y : y * n + x;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  let nonManifold = 0;
  for (const count of edges.values()) {
    if (count === 1) open++;
    else if (count > 2) nonManifold++;
  }
  return { open, nonManifold };
}

export function bedSize(config: Config | null): [number, number, number] | undefined {
  const area = config?.printable_area;
  if (!Array.isArray(area)) return undefined;
  const points = area.map((p) => String(p).split("x").map(Number));
  return [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])), num(config!.printable_height)];
}

export function analyzeGeometry(project: BambuProject): GeometryReport {
  const { meshes } = project;
  const bounds = meshBounds(meshes);
  const size = boundsSize(bounds);
  const stats = meshStats(meshes);

  // 貼平台的面：在最低點 0.2mm 內、法向量幾乎朝正下方
  let contact = 0;
  for (const { positions: p, indices } of meshes) {
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      if (Math.max(p[a + 2], p[b + 2], p[c + 2]) - bounds.min[2] > 0.2) continue;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
      if (len > 0 && nz / len < -0.9) contact += len / 2;
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const mesh of meshes) {
    const e = edgeCheck(mesh);
    openEdges += e.open;
    nonManifoldEdges += e.nonManifold;
  }

  const bed = bedSize(project.config);
  const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    sizeMm: size.map((v) => round(v)) as [number, number, number],
    objects: project.objectCount,
    triangles: stats.triangles,
    volumeCm3: round(Math.abs(stats.volumeMm3) / 1000, 2),
    surfaceAreaCm2: round(stats.surfaceAreaMm2 / 100),
    overhangAreaCm2: round(stats.overhangAreaMm2 / 100),
    overhangRatio: round(stats.surfaceAreaMm2 > 0 ? stats.overhangAreaMm2 / stats.surfaceAreaMm2 : 0, 3),
    baseContactAreaMm2: round(contact),
    heightToBase: round(size[2] / Math.max(Math.sqrt(contact), 1), 2),
    // 網站產生的檔案模型本身就貼平台；Bambu Studio 的專案用位移決定高度
    floatingMm: round(Math.max(0, bounds.min[2]), 2),
    openEdges,
    nonManifoldEdges,
    bedMm: bed,
    fitsBed: bed ? size[0] <= bed[0] && size[1] <= bed[1] && size[2] <= bed[2] : undefined,
  };
}

// 粗估重量、時間、成本（沿用「製作模型」頁的估算方式）
export function estimateFromProject(project: BambuProject, pricePerKg?: number): PrintEstimate & { material: string } {
  const c = project.config ?? {};
  const type = String(first(c.filament_type) ?? "PLA").toUpperCase();
  const material = (["PETG", "ABS", "TPU"].find((m) => type.includes(m)) ?? "PLA") as "PLA" | "PETG" | "ABS" | "TPU";
  const stats = meshStats(project.meshes);
  const size = boundsSize(meshBounds(project.meshes));
  const support = num(c.enable_support) === 1 ? (String(first(c.support_type)).startsWith("tree") ? "tree" : "normal") : "none";
  const estimate = estimatePrint({ ...stats, volumeMm3: Math.abs(stats.volumeMm3) }, size[2], {
    material,
    layerHeight: num(c.layer_height) || 0.2,
    infillPercent: parseFloat(String(first(c.sparse_infill_density) ?? "15")) || 0,
    wallLoops: num(c.wall_loops) || 2,
    support,
    pricePerKg: pricePerKg ?? PRINT_MATERIALS.find((m) => m.value === material)!.pricePerKg,
  });
  return { ...estimate, material };
}

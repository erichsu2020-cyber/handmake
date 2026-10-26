// 「AI 列印檢查」前後端共用：需求表單、上傳位置、報告格式

export const PRINT_CHECK_FOLDER = "handmake/print-checks/";
// 從電腦上傳的 Bambu 3MF
export const PRINT_CHECK_UPLOAD_FOLDER = `${PRINT_CHECK_FOLDER}uploads/`;
// 瀏覽器拍的模型截圖
export const PRINT_CHECK_SNAPSHOT_FOLDER = `${PRINT_CHECK_FOLDER}snapshots/`;
export const MAX_PRINT_CHECK_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;
export const MAX_SNAPSHOTS = 4;

export const PRIORITIES = [
  { value: "appearance", label: "外觀" },
  { value: "strength", label: "強度" },
  { value: "speed", label: "速度" },
  { value: "cost", label: "成本" },
] as const;

export const ENVIRONMENTS = [
  { value: "indoor", label: "室內擺放" },
  { value: "outdoor", label: "戶外／日曬" },
  { value: "heat", label: "高溫（車內、熱水）" },
  { value: "load", label: "會受力、摔落" },
  { value: "food", label: "接觸食物" },
  { value: "skin", label: "接觸皮膚、兒童使用" },
] as const;

export type Priority = (typeof PRIORITIES)[number]["value"];
export type Environment = (typeof ENVIRONMENTS)[number]["value"];

export type PrintRequirements = {
  purpose: string; // 這是什麼、拿來做什麼
  quantity: number;
  priorities: Priority[]; // 最在意的，依序
  environments: Environment[];
  budgetPerPiece?: number; // NT$，每個
  notes: string;
};

export const DEFAULT_REQUIREMENTS: PrintRequirements = {
  purpose: "",
  quantity: 1,
  priorities: ["appearance"],
  environments: ["indoor"],
  notes: "",
};

export function parseRequirements(input: unknown): PrintRequirements | string {
  const r = (input ?? {}) as Partial<PrintRequirements>;
  if (typeof r.purpose !== "string" || !r.purpose.trim()) return "請填寫產品用途";
  if (r.purpose.length > 300) return "產品用途不能超過 300 字";
  if (typeof r.quantity !== "number" || !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 100000) {
    return "數量要介於 1–100000";
  }
  if (!Array.isArray(r.priorities) || r.priorities.length === 0) return "請至少選一個最在意的項目";
  if (!r.priorities.every((p) => PRIORITIES.some((o) => o.value === p))) return "在意項目不正確";
  if (!Array.isArray(r.environments) || !r.environments.every((e) => ENVIRONMENTS.some((o) => o.value === e))) {
    return "使用環境不正確";
  }
  if (r.budgetPerPiece !== undefined && !(typeof r.budgetPerPiece === "number" && r.budgetPerPiece >= 0)) {
    return "預算格式不正確";
  }
  if (typeof r.notes !== "string" || r.notes.length > 1000) return "補充說明不能超過 1000 字";
  return {
    purpose: r.purpose.trim(),
    quantity: r.quantity,
    priorities: [...new Set(r.priorities)],
    environments: [...new Set(r.environments)],
    ...(r.budgetPerPiece !== undefined ? { budgetPerPiece: r.budgetPerPiece } : {}),
    notes: r.notes.trim(),
  };
}

// 設定值的中文顯示（報告表格用）；沒列到的照原樣顯示
const VALUE_LABELS: Record<string, Record<string, string>> = {
  enable_support: { "1": "開", "0": "關" },
  support_type: { "tree(auto)": "樹狀（自動）", "normal(auto)": "一般（自動）" },
  brim_type: { auto_brim: "自動", outer_only: "僅外側", inner_only: "僅內側", outer_and_inner: "內外側", no_brim: "無" },
  ironing_type: { "no ironing": "不熨燙", top: "頂面", topmost: "最上層", solid: "所有實心面" },
  seam_position: { aligned: "對齊", nearest: "最近", back: "背面", random: "隨機" },
  sparse_infill_pattern: {
    grid: "網格",
    gyroid: "螺旋（Gyroid）",
    cubic: "立方",
    honeycomb: "蜂巢",
    triangles: "三角形",
    lightning: "閃電",
    line: "直線",
    adaptivecubic: "自適應立方",
    "zig-zag": "之字形",
  },
};

export const formatSettingValue = (key: string, value: string) => VALUE_LABELS[key]?.[value] ?? value;

// ---------- AI 報告 ----------

export const CHECK_CATEGORIES = [
  { id: "surface", label: "表面品質" },
  { id: "strength", label: "強度" },
  { id: "placement", label: "擺放與支撐" },
  { id: "cost", label: "商用成本" },
  { id: "model", label: "模型問題" },
] as const;

export const VERDICTS = {
  ready: { label: "可以列印", tone: "good" },
  risky: { label: "可以印，但有風險", tone: "warning" },
  not_recommended: { label: "不建議直接列印", tone: "problem" },
} as const;

export const RATINGS = {
  good: "良好",
  warning: "注意",
  problem: "問題",
} as const;

export type CategoryId = (typeof CHECK_CATEGORIES)[number]["id"];
export type Verdict = keyof typeof VERDICTS;
export type Rating = keyof typeof RATINGS;

export type AiReport = {
  verdict: Verdict;
  summary: string;
  categories: { id: CategoryId; rating: Rating; findings: string[] }[];
  changes: { key: string; value: string; reason: string }[];
  manualAdvice: { title: string; detail: string }[];
};

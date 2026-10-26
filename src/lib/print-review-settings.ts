// 「成品改良」前後端共用：照片、狀況描述、報告格式
// 使用者拍下已經印好的實體產品，AI 對照當初列印的 Bambu 檔（設定＋3D 模型截圖）找出問題和改善方式

export const PRINT_REVIEW_FOLDER = "handmake/print-reviews/";
export const PRINT_REVIEW_PHOTO_FOLDER = `${PRINT_REVIEW_FOLDER}photos/`;
export const PRINT_REVIEW_SNAPSHOT_FOLDER = `${PRINT_REVIEW_FOLDER}snapshots/`;
export const PRINT_REVIEW_UPLOAD_FOLDER = `${PRINT_REVIEW_FOLDER}uploads/`;
export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
// 瀏覽器先把照片縮到長邊這麼大再上傳（上傳快、AI 費用低，細節也夠看）
export const PHOTO_MAX_EDGE = 1600;

export const SYMPTOMS = [
  { value: "warping", label: "翹邊、底部翹起" },
  { value: "adhesion_fail", label: "沒黏住平台、印到一半移位" },
  { value: "elephant_foot", label: "象腳（底部向外擴）" },
  { value: "stringing", label: "拉絲" },
  { value: "blobs", label: "結塊、小疙瘩" },
  { value: "layer_lines", label: "層紋明顯" },
  { value: "ghosting", label: "震紋、波紋" },
  { value: "seam", label: "接縫明顯" },
  { value: "rough_surface", label: "表面粗糙" },
  { value: "under_extrusion", label: "缺料、表面有洞或縫" },
  { value: "over_extrusion", label: "過擠、溢料" },
  { value: "top_holes", label: "頂面破洞、凹陷" },
  { value: "sagging", label: "懸空處下垂、塌陷" },
  { value: "support_hard", label: "支撐難拆、有殘留" },
  { value: "support_marks", label: "支撐接觸面很醜" },
  { value: "layer_separation", label: "層間分離、裂開" },
  { value: "broken_detail", label: "細節斷掉或沒印出來" },
  { value: "dimension", label: "尺寸不準" },
  { value: "color_uneven", label: "顏色或光澤不均" },
] as const;

const YES_NO = [
  { value: "yes", label: "有" },
  { value: "no", label: "沒有" },
  { value: "unknown", label: "不確定" },
] as const;

// 材料與機器狀態：照片通常看不出來，但常常是問題的主因
export const CONDITIONS = {
  filamentAge: {
    label: "線材開封多久",
    options: [
      { value: "new", label: "一週內" },
      { value: "month", label: "一個月內" },
      { value: "older", label: "超過一個月" },
      { value: "unknown", label: "不確定" },
    ],
  },
  filamentStorage: {
    label: "線材怎麼保存",
    options: [
      { value: "sealed", label: "密封袋／防潮箱" },
      { value: "ams", label: "一直放在 AMS" },
      { value: "open", label: "直接放在外面" },
      { value: "unknown", label: "不確定" },
    ],
  },
  filamentDried: { label: "印之前有烘乾線材", options: YES_NO },
  bedCleaned: { label: "最近有清潔平台（洗碗精或酒精）", options: YES_NO },
  calibrated: { label: "列印前有做自動校正", options: YES_NO },
  nozzleUsage: {
    label: "噴嘴狀況",
    options: [
      { value: "new", label: "新的或剛換" },
      { value: "normal", label: "正常使用中" },
      { value: "heavy", label: "很久沒換／印過碳纖維" },
      { value: "unknown", label: "不確定" },
    ],
  },
  slicerModified: { label: "列印前有在 Bambu Studio 改過設定", options: YES_NO },
} as const;

export const ENVIRONMENT_CONDITIONS = [
  { value: "draft", label: "冷氣或風扇直吹" },
  { value: "cold", label: "室溫偏低（18°C 以下）" },
  { value: "humid", label: "環境潮濕" },
  { value: "door_closed", label: "密閉機箱，門和上蓋關著" },
  { value: "door_open", label: "密閉機箱，門或上蓋開著" },
] as const;

export type Symptom = (typeof SYMPTOMS)[number]["value"];
export type ConditionKey = keyof typeof CONDITIONS;
export type EnvironmentCondition = (typeof ENVIRONMENT_CONDITIONS)[number]["value"];

export type ReviewDetails = {
  symptoms: Symptom[];
  conditions: Record<ConditionKey, string>;
  environment: EnvironmentCondition[];
  notes: string;
};

export const DEFAULT_DETAILS: ReviewDetails = {
  symptoms: [],
  conditions: Object.fromEntries(Object.keys(CONDITIONS).map((k) => [k, "unknown"])) as Record<ConditionKey, string>,
  environment: [],
  notes: "",
};

export function parseDetails(input: unknown): ReviewDetails | string {
  const d = (input ?? {}) as Partial<ReviewDetails>;
  if (!Array.isArray(d.symptoms) || !d.symptoms.every((s) => SYMPTOMS.some((o) => o.value === s))) return "問題選項不正確";
  if (!Array.isArray(d.environment) || !d.environment.every((e) => ENVIRONMENT_CONDITIONS.some((o) => o.value === e))) {
    return "環境選項不正確";
  }
  const conditions = {} as Record<ConditionKey, string>;
  for (const [key, def] of Object.entries(CONDITIONS) as [ConditionKey, (typeof CONDITIONS)[ConditionKey]][]) {
    const value = d.conditions?.[key] ?? "unknown";
    if (!def.options.some((o) => o.value === value)) return `「${def.label}」的選項不正確`;
    conditions[key] = value;
  }
  if (typeof d.notes !== "string" || d.notes.length > 1000) return "補充說明不能超過 1000 字";
  return { symptoms: [...new Set(d.symptoms)], conditions, environment: [...new Set(d.environment)], notes: d.notes.trim() };
}

// 給 AI 和報告看的文字
export function describeDetails(d: ReviewDetails) {
  const label = (list: readonly { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v;
  return {
    symptoms: d.symptoms.map((s) => label(SYMPTOMS, s)),
    conditions: (Object.keys(CONDITIONS) as ConditionKey[]).map((k) => ({
      label: CONDITIONS[k].label,
      value: label(CONDITIONS[k].options, d.conditions[k]),
    })),
    environment: d.environment.map((e) => label(ENVIRONMENT_CONDITIONS, e)),
    notes: d.notes,
  };
}

// ---------- AI 報告 ----------

export const CAUSE_CATEGORIES = [
  { id: "model", label: "模型" },
  { id: "settings", label: "列印設定" },
  { id: "material_machine", label: "材料與機器狀態" },
] as const;

export const LIKELIHOODS = { high: "很可能", medium: "有可能", low: "不太可能" } as const;
export const SEVERITIES = { minor: "輕微", moderate: "明顯", severe: "嚴重" } as const;
export const EFFORTS = { free: "免費、馬上可做", low: "簡單", medium: "要花點時間", high: "較費工" } as const;

export type CauseCategory = (typeof CAUSE_CATEGORIES)[number]["id"];
export type Likelihood = keyof typeof LIKELIHOODS;

export type ReviewReport = {
  summary: string;
  causes: { category: CauseCategory; likelihood: Likelihood; reasons: string[] }[];
  observedIssues: { issue: string; location: string; severity: keyof typeof SEVERITIES; category: CauseCategory }[];
  // 改善順序：陣列順序就是建議的順序
  steps: { title: string; detail: string; category: CauseCategory; effort: keyof typeof EFFORTS }[];
  // 改善方向｜實物可能出現的問題｜建議調整
  table: { direction: string; problem: string; adjustment: string; category: CauseCategory }[];
  changes: { key: string; value: string; reason: string }[];
  // 照片不足以判斷時，建議再拍什麼
  photoTips: string[];
};

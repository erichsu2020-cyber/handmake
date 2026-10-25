// 「設計 3D 圖」頁面的選項與提示詞組合（前端即時預覽、後端實際送出共用同一份）

type Option = { value: string; label: string; prompt: string };

export const DESIGN_STYLES: Option[] = [
  { value: "realistic", label: "寫實", prompt: "photorealistic 3D render with physically based materials" },
  { value: "cartoon", label: "卡通", prompt: "stylized cartoon 3D character style, like an animated film" },
  { value: "figurine", label: "公仔", prompt: "collectible vinyl figurine with smooth glossy surfaces" },
  { value: "chibi", label: "Q 版", prompt: "chibi proportions with a large head and small body" },
  { value: "lowpoly", label: "低多邊形", prompt: "low-poly 3D model with flat-shaded faceted surfaces" },
  { value: "clay", label: "黏土", prompt: "handmade clay model with soft rounded shapes and fingerprint texture" },
  { value: "wood", label: "木雕", prompt: "hand-carved wooden sculpture with visible carving facets" },
  { value: "brick", label: "積木", prompt: "built from interlocking toy bricks" },
  { value: "scifi", label: "科幻", prompt: "sleek sci-fi hard-surface design with panel lines" },
];

export const DESIGN_MATERIALS: Option[] = [
  { value: "auto", label: "不指定", prompt: "" },
  { value: "plastic", label: "塑膠", prompt: "matte plastic" },
  { value: "resin", label: "樹脂", prompt: "smooth resin" },
  { value: "metal", label: "金屬", prompt: "brushed metal" },
  { value: "wood", label: "木頭", prompt: "natural wood" },
  { value: "ceramic", label: "陶瓷", prompt: "glazed ceramic" },
  { value: "stone", label: "石材", prompt: "carved stone" },
  { value: "glass", label: "玻璃", prompt: "frosted glass" },
];

export const DESIGN_VIEWS: Option[] = [
  { value: "threequarter", label: "斜前方 3/4", prompt: "slightly elevated 3/4 front view" },
  { value: "front", label: "正面", prompt: "straight front view" },
  { value: "side", label: "側面", prompt: "side profile view" },
  { value: "back", label: "背面", prompt: "back view" },
  { value: "top", label: "俯視", prompt: "top-down view" },
  { value: "low", label: "仰視", prompt: "low-angle heroic view looking up" },
];

export const DESIGN_LIGHTING: Option[] = [
  { value: "studio", label: "柔和攝影棚", prompt: "soft even studio lighting" },
  { value: "dramatic", label: "戲劇性", prompt: "dramatic rim lighting with deep shadows" },
  { value: "natural", label: "自然光", prompt: "warm natural daylight" },
  { value: "neon", label: "霓虹", prompt: "colorful neon lighting" },
];

export const DESIGN_BACKGROUNDS: Option[] = [
  { value: "white", label: "純白", prompt: "plain pure white background" },
  { value: "gray", label: "淺灰", prompt: "plain light gray background" },
  { value: "gradient", label: "漸層", prompt: "smooth soft gradient background" },
  { value: "scene", label: "情境場景", prompt: "a simple fitting environment behind the subject" },
];

export const DESIGN_SIZES = [
  { value: "1024x1024", label: "正方形 1:1" },
  { value: "1024x1536", label: "直式 2:3" },
  { value: "1536x1024", label: "橫式 3:2" },
] as const;

export const DESIGN_QUALITIES = [
  { value: "low", label: "低（最快、最便宜）" },
  { value: "medium", label: "中" },
  { value: "high", label: "高（最慢、最貴）" },
  { value: "auto", label: "自動（建議）" },
] as const;

export const MAX_COLORS = 3;
export const MAX_COUNT = 4;

export type DesignInput = {
  subject: string;
  details: string;
  style: string;
  material: string;
  colors: string[];
  view: string;
  lighting: string;
  background: string;
  printFriendly: boolean;
  avoid: string;
  size: (typeof DESIGN_SIZES)[number]["value"];
  quality: (typeof DESIGN_QUALITIES)[number]["value"];
  count: number;
};

export const DEFAULT_DESIGN: DesignInput = {
  subject: "",
  details: "",
  style: "figurine",
  material: "auto",
  colors: [],
  view: "threequarter",
  lighting: "studio",
  background: "white",
  printFriendly: true,
  avoid: "",
  size: "1024x1024",
  quality: "auto",
  count: 1,
};

const find = (options: Option[], value: string) => options.find((o) => o.value === value);

export function parseDesignInput(input: unknown): DesignInput | string {
  const d = { ...DEFAULT_DESIGN, ...((input ?? {}) as Partial<DesignInput>) };

  if (typeof d.subject !== "string" || !d.subject.trim()) return "請填寫主題";
  if (d.subject.length > 200) return "主題不能超過 200 字";
  for (const key of ["details", "avoid"] as const) {
    if (typeof d[key] !== "string") return `${key} 格式不正確`;
    if (d[key].length > 1000) return "描述不能超過 1000 字";
  }
  if (!find(DESIGN_STYLES, d.style)) return "風格選項不正確";
  if (!find(DESIGN_MATERIALS, d.material)) return "材質選項不正確";
  if (!find(DESIGN_VIEWS, d.view)) return "視角選項不正確";
  if (!find(DESIGN_LIGHTING, d.lighting)) return "光線選項不正確";
  if (!find(DESIGN_BACKGROUNDS, d.background)) return "背景選項不正確";
  if (!DESIGN_SIZES.some((s) => s.value === d.size)) return "尺寸選項不正確";
  if (!DESIGN_QUALITIES.some((q) => q.value === d.quality)) return "品質選項不正確";
  if (
    !Array.isArray(d.colors) ||
    d.colors.length > MAX_COLORS ||
    !d.colors.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
  ) {
    return `主色最多 ${MAX_COLORS} 個，格式為 #RRGGBB`;
  }
  if (!Number.isInteger(d.count) || d.count < 1 || d.count > MAX_COUNT) {
    return `張數要介於 1–${MAX_COUNT}`;
  }
  if (typeof d.printFriendly !== "boolean") return "printFriendly 必須是 true 或 false";

  return { ...d, subject: d.subject.trim(), details: d.details.trim(), avoid: d.avoid.trim() };
}

// 把表單組成英文提示詞（OpenAI 對英文的控制比較穩定，中文內容會原樣帶入）
export function buildDesignPrompt(d: DesignInput, hasReference: boolean) {
  const parts = [
    hasReference
      ? `Using the reference image as the basis, create a 3D model render of: ${d.subject}.`
      : `A 3D model render of: ${d.subject}.`,
    d.details && `Details: ${d.details}.`,
    `Style: ${find(DESIGN_STYLES, d.style)?.prompt}.`,
    find(DESIGN_MATERIALS, d.material)?.prompt && `Material: ${find(DESIGN_MATERIALS, d.material)?.prompt}.`,
    d.colors.length > 0 && `Main colors: ${d.colors.join(", ")}.`,
    `Camera: ${find(DESIGN_VIEWS, d.view)?.prompt}, the entire object fully in frame and centered.`,
    `Lighting: ${find(DESIGN_LIGHTING, d.lighting)?.prompt}.`,
    `Background: ${find(DESIGN_BACKGROUNDS, d.background)?.prompt}.`,
    d.printFriendly &&
      "Design it to be 3D printable: a single solid object with a stable flat base, thick parts, no thin floating pieces or fragile overhangs.",
    "No text, no watermark.",
    d.avoid && `Avoid: ${d.avoid}.`,
  ];
  return parts.filter(Boolean).join(" ");
}

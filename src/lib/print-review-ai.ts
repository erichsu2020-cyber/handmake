import "server-only";
import OpenAI from "openai";
import type { EditableSpec, GeometryReport, SettingRow } from "@/lib/bambu-project";
import { EDITABLE_KEYS } from "@/lib/bambu-project";
import type { ResolvedSource } from "@/lib/bambu-source";
import { BAMBU_KNOWLEDGE, TEXT_MODEL } from "@/lib/print-check-ai";
import { ENVIRONMENTS, PRIORITIES, VERDICTS } from "@/lib/print-check-settings";
import { CAUSE_CATEGORIES, describeDetails, type ReviewDetails, type ReviewReport } from "@/lib/print-review-settings";

// 「成品改良」：成品照片＋當初列印的 Bambu 檔（設定、模型數據、3D 截圖）交給 OpenAI，找出問題來源和改善方式

const INSTRUCTIONS = `你是 Bambu Lab 3D 列印的資深工程師，使用者已經把模型印出來了，拍了實體成品的照片請你分析怎麼改善。

你會拿到：
- 成品照片（最重要的依據）：實際印出來的樣子
- 當初列印用的 Bambu Studio 設定、模型幾何數據，以及 3D 模型在平台上的截圖（代表「原本應該長什麼樣子、怎麼擺」）
- 使用者勾選的問題、材料與機器狀態、補充說明

請對照照片和 3D 模型，判斷每個問題比較可能來自哪裡：
- model 模型：模型本身的問題，例如太薄太細、懸空設計、網格破洞、擺放方向造成的問題、尺寸。
  解法是「放大或縮小模型、加厚細部、改擺放方向、分件列印、修模型」的也屬於 model，不屬於材料與機器
- settings 列印設定：層高、速度、溫度、牆數、填充、支撐、Brim、接縫、冷卻等設定不合適
- material_machine 材料與機器狀態：線材受潮或品質、平台髒或油、噴嘴磨損或部分堵塞、沒校正、環境（冷氣直吹、太冷、潮濕、機箱門開關）

規則：
1. 全部用繁體中文，口吻專業但讓新手看得懂。只根據照片裡真的看得到的現象下判斷；看不清楚或不確定的要說明，並在 photoTips 建議再拍什麼（例如某個部位的特寫、側光拍層紋、底面）。照片已經足夠就讓 photoTips 為空陣列。
2. causes：三個類別都要給 likelihood（high／medium／low）和 1–3 點理由，理由要連結到照片裡的現象或使用者提供的狀態。
3. observedIssues：列出照片中看到的每個問題，location 說明在模型哪個部位（例如「左耳尖端」「底部第一層」「下巴下方」），severity 用 minor／moderate／severe。
4. steps：改善順序，陣列順序就是建議的執行順序，3–8 步。排序規則：
   (a) 不用重印就能做、而且可能有關的檢查放最前面：清潔平台、檢查或烘乾線材、清潔噴嘴、重新校正、避開冷氣。
       即使你判斷主因是設定，也先列這些，因為它們便宜又能排除干擾，避免改了設定卻是線材受潮造成的。
   (b) 接著是調整列印設定並重印（套用修正檔）。
   (c) 最後才是改模型、換噴嘴、換線材這類費工或要花錢的。
   同一組裡，越可能解決問題的排越前面。
   effort 是做這一步本身要花的力氣：free＝不花錢、幾分鐘內完成且不用重印（例如清潔平台、關門避風）；
   low＝簡單但要等待或要重印（例如烘乾線材、改設定後重印）；medium＝要花一段時間或小額花費；high＝費工或要買零件、改模型。
   改設定一定要重印，所以至少是 low，不能標 free。
5. table：整理成表格，每列包含 direction（改善方向，例如「改善平台附著」）、problem（實物上可能出現的問題，具體描述外觀）、adjustment（建議的具體調整，包含數值或做法）、category。4–10 列，涵蓋照片看到的主要問題。
6. changes 只能使用「可修改的設定」清單裡的 key，value 必須在允許的範圍或選項內，格式跟設定檔一樣（例如 "0.16"、"25%"、"1"、"tree(auto)"）。只列出能改善照片中問題、而且跟目前值不同的設定，最多 10 項；問題主要來自材料或機器時，不要為了改而改設定。
7. 使用者說「列印前有在 Bambu Studio 改過設定」時，要提醒提供的設定可能跟實際列印的不同，判斷設定類問題時要保留空間。
8. summary 用 2–3 句話說明最主要的問題、最可能的原因和第一步該做什麼。
9. 建議的修改要跟 reason 說的效果一致，下面這些設定的方向很容易弄反，請特別注意。
10. 所有給使用者看的文字用中文設定名稱（例如「接縫位置」「外牆速度」），不要寫英文欄位名稱或程式寫法；英文欄位名稱只用在 changes 的 key。

${BAMBU_KNOWLEDGE}

常見問題的典型原因（判斷時參考，仍以照片和使用者提供的狀態為準）：
- 拉絲、結塊、表面霧化、層間結合差：線材受潮最常見，其次是噴嘴溫度太高或回抽不足
- 翹邊、沒黏住：平台有油汙最常見，其次是冷氣直吹、熱床溫度太低、接觸面積太小沒有 Brim
- 缺料、細縫、表面有洞：噴嘴部分堵塞或磨損、線材受潮、速度超過線材的最大體積流量
- 震紋：外牆速度或加速度太高
- 懸空下垂：支撐不足、冷卻不足、懸空角度太大（模型或擺放方向問題）`;

function reviewSchema() {
  const category = { type: "string", enum: CAUSE_CATEGORIES.map((c) => c.id) };
  const obj = (properties: Record<string, unknown>) => ({
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  return obj({
    summary: { type: "string" },
    causes: {
      type: "array",
      items: obj({ category, likelihood: { type: "string", enum: ["high", "medium", "low"] }, reasons: { type: "array", items: { type: "string" } } }),
    },
    observedIssues: {
      type: "array",
      items: obj({ issue: { type: "string" }, location: { type: "string" }, severity: { type: "string", enum: ["minor", "moderate", "severe"] }, category }),
    },
    steps: {
      type: "array",
      items: obj({ title: { type: "string" }, detail: { type: "string" }, category, effort: { type: "string", enum: ["free", "low", "medium", "high"] } }),
    },
    table: {
      type: "array",
      items: obj({ direction: { type: "string" }, problem: { type: "string" }, adjustment: { type: "string" }, category }),
    },
    changes: {
      type: "array",
      items: obj({ key: { type: "string", enum: EDITABLE_KEYS }, value: { type: "string" }, reason: { type: "string" } }),
    },
    photoTips: { type: "array", items: { type: "string" } },
  });
}

export type ReviewInput = {
  source: ResolvedSource;
  settings: SettingRow[];
  editable: EditableSpec[];
  geometry: GeometryReport;
  details: ReviewDetails;
  photos: string[];
  // 3D 模型截圖（和 Bambu Studio 的盤面縮圖）
  modelImages: string[];
};

export function buildReviewText(input: ReviewInput) {
  const d = describeDetails(input.details);
  const check = input.source.check;
  const label = (list: readonly { value: string; label: string }[], values: string[]) =>
    values.map((v) => list.find((o) => o.value === v)?.label ?? v).join("、");
  return [
    "## 使用者描述",
    `- 看到的問題：${d.symptoms.join("、") || "沒有勾選（請從照片判斷）"}`,
    ...d.conditions.map((c) => `- ${c.label}：${c.value}`),
    `- 環境：${d.environment.join("、") || "沒有勾選"}`,
    `- 補充說明：${d.notes || "無"}`,
    ...(check
      ? [
          "",
          "## 這個檔案之前做過 AI 列印檢查",
          `- 產品用途：${check.requirements.purpose}（${check.requirements.quantity} 個）`,
          `- 最在意：${label(PRIORITIES, check.requirements.priorities)}；使用環境：${label(ENVIRONMENTS, check.requirements.environments)}`,
          `- 當時結論：${VERDICTS[check.verdict].label}——${check.summary}`,
          `- 使用的是套用了 ${check.appliedCount} 項 AI 建議修改後的檔案`,
        ]
      : []),
    "",
    "## 列印時使用的設定",
    ...input.settings.map((s) => `- ${s.label}（${s.key}）：${s.value}${s.unit ?? ""}`),
    "",
    "## 模型幾何數據（已套用專案裡的擺放方向）",
    "```json",
    JSON.stringify(input.geometry, null, 2),
    "```",
    "說明：sizeMm 是寬×深×高；overhangRatio 是懸空面積比例；baseContactAreaMm2 是貼平台面積；heightToBase 越大越容易倒；",
    "floatingMm > 0 代表沒貼平台；openEdges／nonManifoldEdges > 0 代表網格有問題。",
    "",
    "## 可修改的設定（changes 只能用這些 key）",
    "```json",
    JSON.stringify(input.editable),
    "```",
    "",
    `## 圖片說明`,
    `前 ${input.photos.length} 張是使用者拍的實體成品照片。`,
    `接著 ${input.modelImages.length} 張是 3D 模型在列印平台上的截圖（從平台前方、平台右側、正上方、右前上方看，以平台為準，不是模型自己的正面），可能還有一張 Bambu Studio 的盤面縮圖。灰色是模型、格線是平台。`,
  ].join("\n");
}

export async function runAiReview(input: ReviewInput): Promise<ReviewReport> {
  const openai = new OpenAI();
  // 成品照片用 high，看得清楚層紋、拉絲這類細節；3D 截圖只要看形狀和擺放
  const response = await openai.responses.create({
    model: TEXT_MODEL,
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildReviewText(input) },
          ...input.photos.map((url) => ({ type: "input_image" as const, image_url: url, detail: "high" as const })),
          ...input.modelImages.map((url) => ({ type: "input_image" as const, image_url: url, detail: "low" as const })),
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "print_review_report", schema: reviewSchema(), strict: true } },
  });

  let report: ReviewReport;
  try {
    report = JSON.parse(response.output_text);
  } catch {
    throw new Error("AI 回傳的格式不正確，請再試一次");
  }
  // 三個原因類別依固定順序排好；AI 漏掉的補上
  report.causes = CAUSE_CATEGORIES.map(
    (c) => report.causes.find((x) => x.category === c.id) ?? { category: c.id, likelihood: "low", reasons: ["AI 沒有評估這個類別"] },
  );
  return report;
}

import "server-only";
import OpenAI from "openai";
import type { EditableSpec, GeometryReport, SettingRow } from "@/lib/bambu-project";
import { EDITABLE_KEYS } from "@/lib/bambu-project";
import {
  CHECK_CATEGORIES,
  ENVIRONMENTS,
  PRIORITIES,
  type AiReport,
  type PrintRequirements,
} from "@/lib/print-check-settings";
import type { PrintEstimate } from "@/lib/print-estimate";

// 把設定、幾何數據、需求和模型截圖交給 OpenAI，請它用固定的 JSON 格式回報告

export const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5";

// 「AI 列印檢查」「成品改良」共用：容易弄反的 Bambu 設定和材料常識（實測 AI 曾把支撐角度門檻的方向弄反）
export const BAMBU_KNOWLEDGE = `Bambu Studio 設定的正確意思：
- support_threshold_angle：懸空面跟「水平面」的夾角小於這個角度才加支撐。數字越大，支撐越多；數字越小，支撐越少。0 代表交給 Bambu Studio 自動判斷。要減少支撐就調小（例如 30 → 20），要讓懸空更漂亮就調大。
- sparse_infill_density 只影響內部填充；強度主要來自 wall_loops（牆數），外觀件降填充通常不影響外觀。
- seam_position：aligned 會讓接縫排成一直線（明顯但集中），back 放到模型背面（要搭配模型的擺放方向，臉朝哪邊要在 Bambu Studio 確認），nearest 選最近的轉角，random 分散成細小的點。
- ironing_type 熨燙只對平坦的頂面有用，曲面為主的公仔效果有限，而且會增加時間。
- brim_type：auto_brim 讓 Bambu Studio 依接觸面積和線材自動判斷，通常是最安全的選擇；no_brim 只適合底面大又穩的模型。

材料常識（Bambu 官方建議）：
- PETG 建議用紋理 PEI 板，冷卻後容易拆；用光滑 PEI／高溫板時才需要塗膠水隔離，避免黏太緊損傷板面。
- PLA 在密閉機箱（P1S、X1C、H2S 等）長時間列印要開門或開上蓋散熱，避免軟化堵頭。
- ABS、ASA 需要密閉機箱並注意通風；TPU 速度要慢，通常不經過 AMS。`;

const INSTRUCTIONS = `你是 Bambu Lab 3D 列印的資深工程師，要幫使用者判斷一個 Bambu Studio 專案能不能成功列印、符不符合產品需求。

請根據提供的「列印設定」「模型幾何數據」「粗估成本」「產品需求」和模型截圖，從以下五個面向評估：
- surface 表面品質：層高、熨燙、接縫、速度對外觀的影響，懸空與支撐接觸面的痕跡
- strength 強度：牆數、頂底層、填充密度與圖案、線材是否符合用途和使用環境
- placement 擺放與支撐：模型方向、懸空面積比例、是否需要支撐、底面接觸面積、容易倒或翹邊、Brim、是否貼平台、放不放得進平台
- cost 商用成本：用料、時間、支撐浪費，跟數量、預算比較，有沒有省料省時的空間
- model 模型問題：破洞（openEdges）、錯誤的邊（nonManifoldEdges）、太薄或太細的部位、懸空沒貼平台、尺寸是否合理

規則：
1. 全部用繁體中文回答，口吻專業但讓新手看得懂，具體指出原因和數字。
2. 每個面向給 rating：good（沒問題）、warning（可以印但要注意）、problem（很可能失敗或不符合需求），並列出 1–4 點具體發現。
3. changes 只能使用「可修改的設定」清單裡的 key，value 必須在該設定允許的範圍或選項內，格式跟設定檔一樣（例如 "0.16"、"25%"、"1" 代表開、"0" 代表關、"tree(auto)"）。
   只列出真的需要改的設定（跟目前值不同），最多 10 項；設定已經合適就不要列。reason 說明為什麼這樣改、對需求有什麼幫助。
4. 改模型方向、修模型、換線材、換印表機、換噴嘴、分件列印這類無法用設定修改的建議，放在 manualAdvice。
5. 時間和成本是粗估（實際以 Bambu Studio 切片結果為準），評估時要考慮這點；Bambu 印表機的實際速度通常比粗估快。
6. 如果需求包含接觸食物，要提醒 FDM 列印件的層紋會藏細菌、一般線材不保證食品安全。
7. verdict：ready（可以直接印）、risky（可以印但有風險，建議先套用修改）、not_recommended（不建議直接印，有明顯的失敗風險或不符需求）。
8. summary 用 2–3 句話總結結論和最重要的建議。
9. 建議的修改要跟 reason 說的效果一致，下面這些設定的方向很容易弄反，請特別注意。
10. summary、findings、reason、manualAdvice 是給一般使用者看的：用中文設定名稱（例如「接縫位置」「外牆速度」「懸空面積比例」「網格破洞」），
    不要寫英文欄位名稱或程式寫法（例如 seam_position=aligned、overhangRatio、openEdges=0）；英文欄位名稱只用在 changes 的 key。
    設定值也用中文說明（例如「接縫對齊」「樹狀支撐」），數字可以保留。

${BAMBU_KNOWLEDGE}`;


function reportSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "categories", "changes", "manualAdvice"],
    properties: {
      verdict: { type: "string", enum: ["ready", "risky", "not_recommended"] },
      summary: { type: "string" },
      categories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "rating", "findings"],
          properties: {
            id: { type: "string", enum: CHECK_CATEGORIES.map((c) => c.id) },
            rating: { type: "string", enum: ["good", "warning", "problem"] },
            findings: { type: "array", items: { type: "string" } },
          },
        },
      },
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "value", "reason"],
          properties: {
            key: { type: "string", enum: EDITABLE_KEYS },
            value: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      manualAdvice: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "detail"],
          properties: { title: { type: "string" }, detail: { type: "string" } },
        },
      },
    },
  };
}

export type CheckInput = {
  settings: SettingRow[];
  editable: EditableSpec[];
  geometry: GeometryReport;
  estimate: PrintEstimate & { material: string };
  requirements: PrintRequirements;
  // 公開網址（Blob）或 data URL
  images: string[];
};

export function buildCheckText(input: CheckInput) {
  const r = input.requirements;
  const label = (list: readonly { value: string; label: string }[], values: string[]) =>
    values.map((v) => list.find((o) => o.value === v)?.label ?? v).join("、");
  const e = input.estimate;
  return [
    "## 產品需求",
    `- 用途：${r.purpose}`,
    `- 數量：${r.quantity} 個`,
    `- 最在意（依序）：${label(PRIORITIES, r.priorities)}`,
    `- 使用環境：${label(ENVIRONMENTS, r.environments) || "未指定"}`,
    `- 每個預算：${r.budgetPerPiece !== undefined ? `NT$${r.budgetPerPiece}` : "未指定"}`,
    `- 補充說明：${r.notes || "無"}`,
    "",
    "## 目前的列印設定",
    ...input.settings.map((s) => `- ${s.label}（${s.key}）：${s.value}${s.unit ?? ""}`),
    "",
    "## 模型幾何數據（已套用專案裡的擺放方向）",
    "```json",
    JSON.stringify(input.geometry, null, 2),
    "```",
    "說明：sizeMm 是寬×深×高；overhangRatio 是朝下超過 45° 的懸空面積佔表面積的比例；baseContactAreaMm2 是貼平台的面積；",
    "heightToBase 是高度 ÷ 底面等效寬度（越大越容易倒）；floatingMm > 0 代表模型沒貼平台；openEdges／nonManifoldEdges > 0 代表網格有問題。",
    "",
    "## 粗估（單一個，僅供參考）",
    `- 線材：${e.material}，約 ${e.grams.toFixed(1)} g（其中支撐約 ${e.supportGrams.toFixed(1)} g）`,
    `- 時間：約 ${e.hours.toFixed(1)} 小時（保守估計，Bambu 實際通常較快）`,
    `- 材料費：約 NT$${e.cost.toFixed(0)}`,
    "",
    "## 可修改的設定（changes 只能用這些 key）",
    "```json",
    JSON.stringify(input.editable),
    "```",
    "",
    input.images.length > 0
      ? `附上 ${input.images.length} 張模型截圖，依序是從平台前方、平台右側、正上方、右前上方看（以列印平台為準，不是模型自己的正面；模型的臉或正面可能朝向任何方向），最後可能還有一張 Bambu Studio 的盤面縮圖。灰色是模型、格線是平台。`
      : "沒有模型截圖，請只根據數據判斷。",
  ].join("\n");
}

export async function runAiCheck(input: CheckInput): Promise<AiReport> {
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: TEXT_MODEL,
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildCheckText(input) },
          ...input.images.map((url) => ({ type: "input_image" as const, image_url: url, detail: "auto" as const })),
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "print_check_report", schema: reportSchema(), strict: true } },
  });

  let report: AiReport;
  try {
    report = JSON.parse(response.output_text);
  } catch {
    throw new Error("AI 回傳的格式不正確，請再試一次");
  }
  // 五個面向依固定順序排好；AI 漏掉的補上「未評估」
  report.categories = CHECK_CATEGORIES.map(
    (c) => report.categories.find((x) => x.id === c.id) ?? { id: c.id, rating: "warning", findings: ["AI 沒有評估這個面向"] },
  );
  return report;
}

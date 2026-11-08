import "server-only";
import OpenAI from "openai";
import type { GeometryReport } from "@/lib/bambu-project";
import { TEXT_MODEL } from "@/lib/print-check-ai";
import {
  POCKET_MM,
  POCKET_WALL_MM,
  STEM_FIELDS,
  STEM_MODES,
  splitLayout,
  stemClearanceHeight,
  type AiPlan,
  type EditRequest,
} from "@/lib/model-edit-settings";

// 把模型數據、截圖和使用者的需求交給 OpenAI，請它決定「改成多大」「十字孔做在哪、用哪種做法」
// AI 只回參數，實際的網格運算由 model-edit-geometry.ts 精準計算

const INSTRUCTIONS = `你是 3D 列印產品設計師，專門把小模型改造成可以裝在機械鍵盤軸（Cherry MX 類）上的「按壓回彈」小物，例如桌上的按壓公仔、紓壓按鈕、鍵帽造型。

你要根據模型截圖、幾何數據和使用者的需求，決定修改計畫。程式會依你的參數精準修改網格，你不用輸出模型。

尺寸（targetSizeMm）：
- 單位 mm，width 是 X（左右）、depth 是 Y（前後）、height 是 Z（高）。
- 尺寸模式是「不改」或「指定」時，照抄提供的目標尺寸，sizeReason 簡短說明即可。
- 尺寸模式是「AI 決定」時，依需求說明決定；沒有特別要求變形時保持原本比例（三個軸同一個倍率）。
- 裝在單顆鍵盤軸上的模型，底面通常 18–40 mm、高 15–60 mm 比較穩；太大太重按起來會歪、回彈無力。

十字孔（stem）：
- 柱座和十字孔一律做在模型「目前的底部」（Z 最低、貼平台那面），讓模型站在軸上；看截圖判斷底部是不是模型的正確下方，如果看起來不是（例如模型是躺著的），要在 warnings 提醒使用者先在 Bambu Studio 轉正再來。
- offsetXMm、offsetYMm 是十字孔中心相對於「模型底面中心」的位移，通常放 0, 0；模型重心明顯偏一邊時（例如有尾巴、舉手），往重心方向移，讓按壓時不會歪。
- mode 三種：
  - split（${STEM_MODES.split}）：在模型底部往上 cutHeightMm 的地方切一刀。上半部（本體）底部內嵌十字孔，十字孔藏在模型裡；下半部（底座）挖空把鍵盤軸裝進去，按本體就會壓到軸。外觀最完整，但切割高度的截面和以下的部分都要有至少 ${POCKET_MM + POCKET_WALL_MM * 2} mm 見方的實心區域。切口最好選在模型本來就有分界的地方（例如底座和身體的交界、衣服下襬），切出來比較自然。
  - pocket（${STEM_MODES.pocket}）：底部挖一個 ${POCKET_MM} mm 見方的凹槽讓軸體上蓋退進去，柱座藏在凹槽裡，外觀最乾淨。需要底面平、而且整片至少 ${POCKET_MM + POCKET_WALL_MM * 2} mm 見方都是實心的底面。
  - protrude（${STEM_MODES.protrude}）：柱座從模型底部往下凸出，模型像站在一根短柱上。任何形狀都能用（腳、圓底、小底面），但按壓時模型底部和軸體上蓋之間會看到柱子。
  - 不確定底面夠不夠大、平不平時選 protrude；程式發現 pocket 做不到時也會自動改用 protrude。
  - 使用者已經指定做法時，mode 照抄，只決定位置（和切割高度）。
- cutHeightMm：只有 split 用，單位 mm、從修改後模型的底部算起；其他做法填 0。程式會檢查，太低或切面不夠大時會往上找。
- 十字孔尺寸由使用者決定，你不能改；如果覺得尺寸或間隙不合理（例如比 MX 規格小很多會插不進去），寫在 warnings。

warnings：修改後可能的問題（按壓會歪、太重、太細的部位、柱座附近太薄、方向不對…）。沒有就給空陣列。
printAdvice：列印建議，例如擺放方向、要不要支撐、層高、牆數、先印一個試裝片測試間隙。柱座凸出時模型懸在柱子上，要提醒需要支撐或考慮倒過來印；切開做法兩個部件都正著印，本體底部的凹槽頂是橋接，並說明怎麼組裝（軸先從底座上方壓進方孔卡住，再把本體套上十字軸）。
全部用繁體中文，口吻讓新手看得懂，summary 用 2–3 句話說明你的計畫。`;

function planSchema() {
  const text = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "targetSizeMm", "sizeReason", "stem", "warnings", "printAdvice"],
    properties: {
      summary: text,
      targetSizeMm: {
        type: "object",
        additionalProperties: false,
        required: ["width", "depth", "height"],
        properties: { width: { type: "number" }, depth: { type: "number" }, height: { type: "number" } },
      },
      sizeReason: text,
      stem: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "offsetXMm", "offsetYMm", "cutHeightMm", "reason"],
        properties: {
          mode: { type: "string", enum: Object.keys(STEM_MODES) },
          offsetXMm: { type: "number" },
          offsetYMm: { type: "number" },
          cutHeightMm: { type: "number" },
          reason: text,
        },
      },
      warnings: { type: "array", items: text },
      printAdvice: { type: "array", items: text },
    },
  };
}

export type PlanInput = {
  request: EditRequest;
  geometry: GeometryReport;
  // 不改或指定尺寸時，程式已經算好的目標尺寸
  fixedSizeMm?: [number, number, number];
  images: string[];
};

function buildPlanText({ request, geometry, fixedSizeMm, images }: PlanInput) {
  const mm = (v: number[]) => v.map((x) => x.toFixed(1)).join(" × ");
  const s = request.stem;
  const split = s && splitLayout(s);
  return [
    "## 模型目前的數據（已套用 3MF 裡的擺放方向）",
    "```json",
    JSON.stringify(geometry, null, 2),
    "```",
    "說明：sizeMm 是寬×深×高；baseContactAreaMm2 是貼平台的面積；heightToBase 是高度 ÷ 底面等效寬度（越大越容易倒）；openEdges／nonManifoldEdges > 0 代表網格有問題，可能無法挖孔。",
    "",
    "## 尺寸",
    request.resize.mode === "ai"
      ? "- 尺寸模式：AI 決定（請依需求說明決定 targetSizeMm）"
      : `- 尺寸模式：${request.resize.mode === "keep" ? "不改" : "指定"}，目標尺寸 ${mm(fixedSizeMm!)} mm（請照抄）`,
    "",
    "## 鍵盤軸十字孔",
    s
      ? [
          "- 要加十字孔（使用者輸入的尺寸，單位 mm）：",
          ...STEM_FIELDS.map((f) => `  - ${f.label}：${s[f.key]}`),
          request.stemMode && request.stemMode !== "auto"
            ? `- 做法：使用者指定 ${request.stemMode}（${STEM_MODES[request.stemMode]}），mode 請照抄`
            : "- 做法：交給你選",
          `- protrude／pocket：柱座下方要留 ${stemClearanceHeight(s).toFixed(1)} mm 的退讓空間（按到底時不撞到軸體）`,
          `- split：底座最少 ${split!.minBase.toFixed(1)} mm 高（裝得下軸的下蓋和針腳），組裝後本體和底座之間有 ${split!.gap.toFixed(1)} mm 間隙（按壓行程），總高度會多這麼多`,
        ].join("\n")
      : "- 不加十字孔（stem 欄位隨意填 protrude、0、0、0，reason 寫「不需要」）",
    "",
    "## 需求說明",
    request.notes || "（沒有）",
    "",
    images.length > 0
      ? `附上 ${images.length} 張修改前的模型截圖，依序是從平台前方、平台右側、正上方、右前上方看。灰色是模型、格線是列印平台（模型底部）。`
      : "沒有模型截圖，請只根據數據判斷。",
  ].join("\n");
}

// Vercel 函式最多跑 300 秒（逾時頁面只會看到 504），AI 要在這之前結束，剩下的時間給下載、挖孔和存檔
const AI_TIMEOUT_MS = 200_000;

export async function planModelEdit(input: PlanInput): Promise<AiPlan> {
  // 不自動重試：重試一次就會超過時間上限
  const openai = new OpenAI({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  const started = Date.now();
  const response = await openai.responses
    .create({
      model: TEXT_MODEL,
      instructions: INSTRUCTIONS,
      // 這裡只要選尺寸、位置和做法，不需要深入推理：實測 medium 約 60 秒、low 約 27 秒、minimal 約 15 秒，結果差不多
      ...(TEXT_MODEL.startsWith("gpt-5") ? { reasoning: { effort: "minimal" as const } } : {}),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPlanText(input) },
            // 截圖只用來看形狀和方向，低解析度就夠，也比較快
            ...input.images.map((url) => ({ type: "input_image" as const, image_url: url, detail: "low" as const })),
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "model_edit_plan", schema: planSchema(), strict: true } },
    })
    .catch((error) => {
      if (error instanceof OpenAI.APIConnectionTimeoutError) throw new Error("AI 回應太久（超過 200 秒），請再試一次");
      throw error;
    });
  console.log(`AI 改模型：AI 規劃花了 ${Math.round((Date.now() - started) / 1000)} 秒`);
  try {
    return JSON.parse(response.output_text) as AiPlan;
  } catch {
    throw new Error("AI 回傳的格式不正確，請再試一次");
  }
}

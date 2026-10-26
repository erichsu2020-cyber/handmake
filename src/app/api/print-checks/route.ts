import { getCurrentUser, unauthorized } from "@/lib/auth";
import { UserError, parseSource } from "@/lib/bambu-source";
import { parseRequirements } from "@/lib/print-check-settings";
import { CHECK_SOURCE_TYPES, runPrintCheck } from "@/lib/print-checks";

// AI 分析通常要 1–3 分鐘，預設的時間上限不夠
export const maxDuration = 300;

// 新增一次 AI 列印檢查：瀏覽器已經把截圖（和自己上傳的 3MF）傳到 Blob，這裡只收網址
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "缺少環境變數 OPENAI_API_KEY" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as {
    source?: unknown;
    requirements?: unknown;
    snapshotUrls?: unknown;
  } | null;

  const requirements = parseRequirements(body?.requirements);
  if (typeof requirements === "string") return Response.json({ error: requirements }, { status: 400 });

  const source = parseSource(body?.source, [...CHECK_SOURCE_TYPES]);
  if (!source) return Response.json({ error: "請選擇要檢查的檔案" }, { status: 400 });

  const snapshotUrls = Array.isArray(body?.snapshotUrls) ? body.snapshotUrls : [];
  if (!snapshotUrls.every((u): u is string => typeof u === "string")) {
    return Response.json({ error: "截圖網址不正確" }, { status: 400 });
  }

  try {
    const check = await runPrintCheck(user.id, source, requirements, snapshotUrls);
    return Response.json({ check });
  } catch (error) {
    if (error instanceof UserError) return Response.json({ error: error.message }, { status: error.status });
    console.error("AI 列印檢查失敗", error);
    return Response.json({ error: "檢查失敗，請再試一次" }, { status: 500 });
  }
}

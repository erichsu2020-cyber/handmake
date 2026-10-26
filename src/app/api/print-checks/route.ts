import { getCurrentUser, unauthorized } from "@/lib/auth";
import { parseRequirements } from "@/lib/print-check-settings";
import { PrintCheckError, runPrintCheck, type CheckSource } from "@/lib/print-checks";

// AI 分析通常要 30 秒到 1 分鐘，預設的時間上限不夠
export const maxDuration = 300;

// 新增一次 AI 列印檢查：瀏覽器已經把截圖（和自己上傳的 3MF）傳到 Blob，這裡只收網址
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "缺少環境變數 OPENAI_API_KEY" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as {
    source?: CheckSource;
    requirements?: unknown;
    snapshotUrls?: unknown;
  } | null;

  const requirements = parseRequirements(body?.requirements);
  if (typeof requirements === "string") return Response.json({ error: requirements }, { status: 400 });

  const source = body?.source;
  const validSource =
    (source?.type === "generation" || source?.type === "upload") && typeof source.id === "string"
      ? source
      : source?.type === "file" && typeof source.url === "string" && typeof source.name === "string"
        ? source
        : null;
  if (!validSource) return Response.json({ error: "請選擇要檢查的檔案" }, { status: 400 });

  const snapshotUrls = Array.isArray(body?.snapshotUrls) ? body.snapshotUrls : [];
  if (!snapshotUrls.every((u): u is string => typeof u === "string")) {
    return Response.json({ error: "截圖網址不正確" }, { status: 400 });
  }

  try {
    const check = await runPrintCheck(user.id, validSource, requirements, snapshotUrls);
    return Response.json({ check });
  } catch (error) {
    if (error instanceof PrintCheckError) return Response.json({ error: error.message }, { status: error.status });
    console.error("AI 列印檢查失敗", error);
    return Response.json({ error: "檢查失敗，請再試一次" }, { status: 500 });
  }
}

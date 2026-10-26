import { getCurrentUser, unauthorized } from "@/lib/auth";
import { UserError, parseSource } from "@/lib/bambu-source";
import { parseDetails } from "@/lib/print-review-settings";
import { REVIEW_SOURCE_TYPES, runPrintReview } from "@/lib/print-reviews";

// AI 看成品照片要 1–3 分鐘，預設的時間上限不夠
export const maxDuration = 300;

// 新增一次成品改良分析：瀏覽器已經把照片、模型截圖（和自己上傳的 3MF）傳到 Blob，這裡只收網址
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "缺少環境變數 OPENAI_API_KEY" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as {
    source?: unknown;
    details?: unknown;
    photoUrls?: unknown;
    snapshotUrls?: unknown;
  } | null;

  const source = parseSource(body?.source, [...REVIEW_SOURCE_TYPES]);
  if (!source) return Response.json({ error: "請選擇當初列印的檔案" }, { status: 400 });

  const details = parseDetails(body?.details);
  if (typeof details === "string") return Response.json({ error: details }, { status: 400 });

  const strings = (v: unknown) => (Array.isArray(v) && v.every((u) => typeof u === "string") ? (v as string[]) : null);
  const photoUrls = strings(body?.photoUrls);
  const snapshotUrls = strings(body?.snapshotUrls ?? []);
  if (!photoUrls || !snapshotUrls) return Response.json({ error: "圖片網址不正確" }, { status: 400 });

  try {
    const review = await runPrintReview(user.id, source, details, photoUrls, snapshotUrls);
    return Response.json({ review });
  } catch (error) {
    if (error instanceof UserError) return Response.json({ error: error.message }, { status: error.status });
    console.error("成品改良分析失敗", error);
    return Response.json({ error: "分析失敗，請再試一次" }, { status: 500 });
  }
}

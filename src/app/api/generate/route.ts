import OpenAI from "openai";
import { put } from "@vercel/blob";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { toGenerationView } from "@/lib/generation-view";
import { fetchUploadedImage } from "@/lib/uploaded-image";
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_STYLE,
  IMAGE_QUALITIES,
  STYLE_PRESETS,
} from "@/lib/image-settings";
import { Generation } from "@/models/Generation";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

// 產出適合後續「圖片轉 3D」（例如 Tripo3D）的參考圖：單一物件、完整入鏡、乾淨背景
const STYLE_PROMPT =
  "Render the subject as a single high-quality 3D model, like a Blender product render. " +
  "Show the entire object, fully in frame and centered, from a slightly elevated 3/4 front view. " +
  "Plain pure white background, soft even studio lighting, no cast shadows, no text, no other objects. " +
  "Solid, watertight-looking shapes with clear silhouettes, suitable as input for image-to-3D reconstruction and 3D printing.";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  for (const key of ["OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN"]) {
    if (!process.env[key]) {
      return Response.json(
        { error: `缺少環境變數 ${key}，請在 .env.local 設定` },
        { status: 500 },
      );
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "請用 multipart/form-data 送出" }, { status: 400 });
  }

  const prompt = String(formData.get("prompt") ?? "").trim();
  // 原圖由瀏覽器直接上傳到 Vercel Blob（見 /api/blob-upload），這裡只收網址
  const inputImageUrl = String(formData.get("imageUrl") ?? "").trim() || undefined;
  const style = STYLE_PRESETS.find((s) => s.value === (formData.get("style") ?? DEFAULT_STYLE));
  const quality = IMAGE_QUALITIES.find(
    (q) => q.value === (formData.get("quality") ?? DEFAULT_IMAGE_QUALITY),
  );

  if (!prompt && !inputImageUrl) {
    return Response.json({ error: "請輸入文字或上傳一張圖片" }, { status: 400 });
  }
  if (!style || !quality) {
    return Response.json({ error: "風格或品質選項不正確" }, { status: 400 });
  }

  let file: File | null = null;
  if (inputImageUrl) {
    try {
      const fetched = await fetchUploadedImage(inputImageUrl, "handmake/inputs/");
      if (typeof fetched === "string") return Response.json({ error: fetched }, { status: 400 });
      file = fetched;
    } catch (error) {
      console.error("讀取上傳的原圖失敗", error);
      return Response.json({ error: "讀取上傳的原圖失敗" }, { status: 500 });
    }
  }

  const stylePrompt = style.prompt ? ` Style it ${style.prompt}.` : "";
  const fullPrompt = file
    ? `Turn the object in this image into a 3D model.${stylePrompt} ${STYLE_PROMPT}${prompt ? ` Extra details: ${prompt}` : ""}`
    : `${prompt}.${stylePrompt} ${STYLE_PROMPT}`;

  const openai = new OpenAI();
  let b64: string | undefined;
  try {
    const result = file
      ? await openai.images.edit({ model: MODEL, image: file, prompt: fullPrompt, quality: quality.value })
      : await openai.images.generate({ model: MODEL, prompt: fullPrompt, quality: quality.value });
    b64 = result.data?.[0]?.b64_json;
  } catch (error) {
    console.error("OpenAI 產生圖片失敗", error);
    const message = error instanceof OpenAI.APIError ? error.message : "OpenAI 產生圖片失敗";
    return Response.json({ error: message }, { status: 502 });
  }

  if (!b64) {
    return Response.json({ error: "OpenAI 沒有回傳圖片" }, { status: 502 });
  }

  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put("handmake/outputs/generation.png", Buffer.from(b64, "base64"), {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: true,
    });
  } catch (error) {
    console.error("上傳 Vercel Blob 失敗", error);
    return Response.json({ error: "圖片已產生，但上傳 Vercel Blob 失敗" }, { status: 500 });
  }

  try {
    await connectDB();
    const doc = await Generation.create({
      userId: user.id,
      mode: file ? "image" : "text",
      prompt,
      style: style.value,
      quality: quality.value,
      model: MODEL,
      inputImageUrl,
      outputImageUrl: blob.url,
      outputImagePathname: blob.pathname,
    });

    return Response.json({ generation: toGenerationView(doc.toObject()) });
  } catch (error) {
    console.error("寫入 MongoDB 失敗", error);
    return Response.json({ error: "圖片已產生，但寫入資料庫失敗" }, { status: 500 });
  }
}

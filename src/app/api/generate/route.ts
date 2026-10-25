import OpenAI from "openai";
import { put } from "@vercel/blob";
import { connectDB } from "@/lib/mongodb";
import { Generation } from "@/models/Generation";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// 產出適合後續「圖片轉 3D」（例如 Tripo3D）的參考圖：單一物件、完整入鏡、乾淨背景
const STYLE_PROMPT =
  "Render the subject as a single high-quality 3D model, like a Blender product render. " +
  "Show the entire object, fully in frame and centered, from a slightly elevated 3/4 front view. " +
  "Plain pure white background, soft even studio lighting, no cast shadows, no text, no other objects. " +
  "Solid, watertight-looking shapes with clear silhouettes, suitable as input for image-to-3D reconstruction and 3D printing.";

export async function POST(request: Request) {
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
  const image = formData.get("image");
  const file = image instanceof File && image.size > 0 ? image : null;

  if (!prompt && !file) {
    return Response.json({ error: "請輸入文字或上傳一張圖片" }, { status: 400 });
  }
  if (file && !ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: "只支援 PNG、JPEG、WebP 圖片" }, { status: 400 });
  }
  if (file && file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: "圖片不能超過 20MB" }, { status: 400 });
  }

  const openai = new OpenAI();
  const fullPrompt = file
    ? `Turn the object in this image into a 3D model. ${STYLE_PROMPT}${prompt ? ` Extra details: ${prompt}` : ""}`
    : `${prompt}. ${STYLE_PROMPT}`;

  let b64: string | undefined;
  try {
    const result = file
      ? await openai.images.edit({ model: MODEL, image: file, prompt: fullPrompt })
      : await openai.images.generate({ model: MODEL, prompt: fullPrompt });
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
      mode: file ? "image" : "text",
      prompt,
      model: MODEL,
      inputImage: file
        ? { data: Buffer.from(await file.arrayBuffer()), contentType: file.type }
        : undefined,
      outputImageUrl: blob.url,
      outputImagePathname: blob.pathname,
    });

    return Response.json({ id: doc._id.toString(), imageUrl: blob.url });
  } catch (error) {
    console.error("寫入 MongoDB 失敗", error);
    return Response.json({ error: "圖片已產生，但寫入資料庫失敗" }, { status: 500 });
  }
}

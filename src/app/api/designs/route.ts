import OpenAI from "openai";
import { put } from "@vercel/blob";
import { connectDB } from "@/lib/mongodb";
import { buildDesignPrompt, parseDesignInput } from "@/lib/design-settings";
import { toDesignView } from "@/lib/designs";
import { DesignImage } from "@/models/DesignImage";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// 設計 3D 圖：依表單組出提示詞 → OpenAI 產生 1–4 張 → 存到 Vercel Blob 的 handmake/designs/
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

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("design") ?? "{}"));
  } catch {
    return Response.json({ error: "表單資料格式不正確" }, { status: 400 });
  }
  const design = parseDesignInput(raw);
  if (typeof design === "string") return Response.json({ error: design }, { status: 400 });

  const reference = formData.get("reference");
  const file = reference instanceof File && reference.size > 0 ? reference : null;
  if (file && !ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: "參考圖只支援 PNG、JPEG、WebP" }, { status: 400 });
  }
  if (file && file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: "參考圖不能超過 20MB" }, { status: 400 });
  }

  let referenceImageUrl: string | undefined;
  if (file) {
    try {
      const ext = file.type.split("/")[1];
      const blob = await put(`handmake/designs/references/reference.${ext}`, file, {
        access: "public",
        contentType: file.type,
        addRandomSuffix: true,
      });
      referenceImageUrl = blob.url;
    } catch (error) {
      console.error("上傳參考圖失敗", error);
      return Response.json({ error: "上傳參考圖失敗" }, { status: 500 });
    }
  }

  const prompt = buildDesignPrompt(design, Boolean(file));
  const options = {
    model: MODEL,
    prompt,
    n: design.count,
    size: design.size,
    quality: design.quality,
  };

  const openai = new OpenAI();
  let images: string[];
  try {
    const result = file
      ? await openai.images.edit({ ...options, image: file })
      : await openai.images.generate(options);
    images = (result.data ?? []).map((d) => d.b64_json).filter((b): b is string => Boolean(b));
  } catch (error) {
    console.error("OpenAI 產生設計圖失敗", error);
    const message = error instanceof OpenAI.APIError ? error.message : "OpenAI 產生圖片失敗";
    return Response.json({ error: message }, { status: 502 });
  }

  if (images.length === 0) {
    return Response.json({ error: "OpenAI 沒有回傳圖片" }, { status: 502 });
  }

  let uploaded: { url: string; pathname: string }[];
  try {
    uploaded = await Promise.all(
      images.map((b64) =>
        put("handmake/designs/images/design.png", Buffer.from(b64, "base64"), {
          access: "public",
          contentType: "image/png",
          addRandomSuffix: true,
        }),
      ),
    );
  } catch (error) {
    console.error("上傳設計圖到 Vercel Blob 失敗", error);
    return Response.json({ error: "圖片已產生，但上傳 Vercel Blob 失敗" }, { status: 500 });
  }

  try {
    await connectDB();
    const doc = await DesignImage.create({
      ...design,
      prompt,
      model: MODEL,
      referenceImageUrl,
      images: uploaded.map(({ url, pathname }) => ({ url, pathname })),
    });
    return Response.json({ design: toDesignView(doc.toObject()) });
  } catch (error) {
    console.error("寫入 MongoDB 失敗", error);
    return Response.json({ error: "圖片已產生，但寫入資料庫失敗" }, { status: 500 });
  }
}

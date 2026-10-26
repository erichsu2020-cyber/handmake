import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { BAMBU_UPLOAD_FOLDER, BAMBU_UPLOAD_TYPES, MAX_BAMBU_UPLOAD_BYTES } from "@/lib/bambu-settings";

const IMAGES = { types: ["image/png", "image/jpeg", "image/webp"], maxBytes: 20 * 1024 * 1024 };
// 瀏覽器只能上傳到這幾個資料夾，不能覆蓋產出的圖片或模型
const FOLDERS = [
  { prefix: "handmake/inputs/", ...IMAGES },
  { prefix: "handmake/designs/references/", ...IMAGES },
  { prefix: BAMBU_UPLOAD_FOLDER, types: Object.values(BAMBU_UPLOAD_TYPES), maxBytes: MAX_BAMBU_UPLOAD_BYTES },
];

// 瀏覽器直接上傳到 Vercel Blob：這裡只檢查登入和檔案限制，再發一張短期的上傳許可，
// 檔案本身不經過伺服器，所以不受 Vercel 函式 4.5MB 請求大小的限制
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "缺少環境變數 BLOB_READ_WRITE_TOKEN" }, { status: 500 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "請求格式不正確" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await getCurrentUser())) throw new Error("UNAUTHORIZED");
        const folder = FOLDERS.find((f) => pathname.startsWith(f.prefix));
        if (!folder) throw new Error("不允許上傳到這個位置");
        return {
          allowedContentTypes: folder.types,
          maximumSizeInBytes: folder.maxBytes,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return unauthorized();
    console.error("產生上傳許可失敗", error);
    const message = error instanceof Error ? error.message : "產生上傳許可失敗";
    return Response.json({ error: message }, { status: 400 });
  }
}

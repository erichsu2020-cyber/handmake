import "server-only";

// 瀏覽器直接上傳到 Blob 後只會送網址過來，伺服器下載前要先確認網址是自己 Blob 的指定資料夾，
// 不然有人可以送任意網址，讓伺服器去下載別的網站

// token 長這樣：vercel_blob_rw_<storeId>_<secret>，網址的主機是 <storeid>.public.blob.vercel-storage.com
function blobHost() {
  const storeId = process.env.BLOB_READ_WRITE_TOKEN?.split("_")[3];
  return storeId ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

// 是自己 Blob、而且在 folder（例如 "handmake/inputs/"）底下就回傳 URL，否則回傳 null
export function ownBlobUrl(rawUrl: string, folder: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const ok = url.protocol === "https:" && url.host === blobHost() && url.pathname.startsWith(`/${folder}`);
  return ok ? url : null;
}

// Vercel Blob 的網址加上 ?download=1 會強制下載，而不是在瀏覽器打開
export const downloadUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download=1`;

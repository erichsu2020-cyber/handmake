// 登入後要回到的頁面：只允許站內路徑，避免被導到別的網站
export function safeNext(value: unknown) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

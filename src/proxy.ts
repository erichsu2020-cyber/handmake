import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

// 第一道門：沒有登入 cookie 就直接擋掉（頁面導到登入頁、API 回 401）
// 這裡只看 cookie 存不存在，cookie 是否有效由各頁面、API 用 lib/auth.ts 檢查
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "請先登入" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // 登入頁、Next 自己的靜態檔案、網站圖示不用擋
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};

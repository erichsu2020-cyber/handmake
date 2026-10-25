// proxy 和 auth 共用；proxy 只看有沒有這個 cookie，真正的驗證在 lib/auth.ts
export const SESSION_COOKIE = "handmake_session";
export const SESSION_DAYS = 30;

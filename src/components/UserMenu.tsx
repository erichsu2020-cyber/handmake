import { logout } from "@/app/login/actions";
import { requireUser } from "@/lib/auth";

// 每個 (site) 頁面都會經過這裡，cookie 失效或被登出就會導回登入頁
export default async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-40 truncate text-sm text-muted lg:inline" title={user.username}>
        {user.username}
      </span>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-full border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-foreground hover:text-foreground"
        >
          登出
        </button>
      </form>
    </div>
  );
}

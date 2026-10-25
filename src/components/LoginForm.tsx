"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "@/app/login/actions";

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">帳號</span>
        <input
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.username}
          placeholder="你的帳號"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">密碼</span>
        <div className="relative">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${inputClass} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-3 my-auto h-fit rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            {showPassword ? "隱藏" : "顯示"}
          </button>
        </div>
      </label>

      {state.error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-xl bg-accent py-3 font-medium text-white shadow-lg shadow-accent/25 transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "登入中…" : "登入"}
      </button>
    </form>
  );
}

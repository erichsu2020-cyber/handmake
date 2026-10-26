import { Suspense } from "react";
import CreateForm from "@/components/CreateForm";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "製作模型 | 小物屋" };

// 表單是前端元件；先在伺服器確認登入，cookie 無效時不會先把表單送出去
export default function CreatePage() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-2xl px-4 py-10 text-zinc-500">載入中…</p>}>
      <Guarded />
    </Suspense>
  );
}

async function Guarded() {
  await requireUser();
  return <CreateForm />;
}

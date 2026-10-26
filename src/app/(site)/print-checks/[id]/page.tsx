import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import PrintCheckReport from "@/components/PrintCheckReport";
import { requireUser } from "@/lib/auth";
import { getPrintCheck } from "@/lib/print-checks";

export const metadata = { title: "AI 列印檢查報告 | 小物屋" };

export default function PrintCheckReportPage({ params }: PageProps<"/print-checks/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
        <Link href="/print-checks" className="hover:text-foreground">
          ← 檢查紀錄
        </Link>
        <Link href="/print-check" className="hover:text-foreground">
          再檢查一個
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <Report params={params} />
      </Suspense>
    </main>
  );
}

async function Report({ params }: { params: PageProps<"/print-checks/[id]">["params"] }) {
  await connection(); // 每次都讀最新資料
  const { id } = await params;
  const user = await requireUser();
  const check = await getPrintCheck(id, user.id);
  if (!check) notFound();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{check.sourceName}</h1>
        <p className="text-sm text-zinc-500">{new Date(check.createdAt).toLocaleString("zh-TW")} 檢查</p>
      </div>
      <PrintCheckReport check={check} />
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import PrintReviewReport from "@/components/PrintReviewReport";
import { requireUser } from "@/lib/auth";
import { getPrintReview } from "@/lib/print-reviews";

export const metadata = { title: "成品改良報告 | 小物屋" };

export default function PrintReviewReportPage({ params }: PageProps<"/print-reviews/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
        <Link href="/print-reviews" className="hover:text-foreground">
          ← 改良紀錄
        </Link>
        <Link href="/print-review" className="hover:text-foreground">
          再分析一個
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">載入中…</p>}>
        <Report params={params} />
      </Suspense>
    </main>
  );
}

async function Report({ params }: { params: PageProps<"/print-reviews/[id]">["params"] }) {
  await connection(); // 每次都讀最新資料
  const { id } = await params;
  const user = await requireUser();
  const review = await getPrintReview(id, user.id);
  if (!review) notFound();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{review.sourceName}</h1>
        <p className="text-sm text-zinc-500">{new Date(review.createdAt).toLocaleString("zh-TW")} 分析</p>
      </div>
      <PrintReviewReport review={review} />
    </>
  );
}

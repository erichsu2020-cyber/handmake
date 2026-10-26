import SettingChangesTable from "@/components/SettingChangesTable";
import { downloadUrl } from "@/lib/blob-url";
import {
  CAUSE_CATEGORIES,
  EFFORTS,
  LIKELIHOODS,
  SEVERITIES,
  describeDetails,
  type CauseCategory,
  type Likelihood,
} from "@/lib/print-review-settings";
import type { PrintReviewView } from "@/lib/print-reviews";

// 成品改良的報告（伺服器元件）

const LIKELIHOOD_TONE: Record<Likelihood, string> = {
  high: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  medium: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  low: "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
};
const SEVERITY_TONE = { minor: "text-zinc-500", moderate: "text-amber-700 dark:text-amber-400", severe: "text-red-700 dark:text-red-400" };
const categoryLabel = (c: CauseCategory) => CAUSE_CATEGORIES.find((x) => x.id === c)?.label ?? c;

function CategoryTag({ category }: { category: CauseCategory }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      {categoryLabel(category)}
    </span>
  );
}

const th = "p-2.5 font-normal";
const td = "p-2.5 align-top";

export default function PrintReviewReport({ review }: { review: PrintReviewView }) {
  const { report } = review;
  const described = describeDetails(review.details);

  return (
    <div className="flex flex-col gap-6">
      {/* 結論 */}
      <section className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent-soft p-4">
        <p className="text-lg font-semibold">分析結論</p>
        <p>{report.summary}</p>
      </section>

      {/* 成品照片 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">成品照片</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {review.photoUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`成品照片 ${i + 1}`} className="aspect-square w-full rounded-lg border border-zinc-300 object-cover dark:border-zinc-700" />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>
            </a>
          ))}
        </div>
      </section>

      {/* 問題來源 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">問題來源</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {report.causes.map((c) => (
            <div key={c.category} className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{categoryLabel(c.category)}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs ${LIKELIHOOD_TONE[c.likelihood]}`}>{LIKELIHOODS[c.likelihood]}</span>
              </div>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {c.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 照片看到的問題 */}
      {report.observedIssues.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">照片中看到的問題</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-foreground/5 text-zinc-500">
                <tr>
                  <th className={th}>問題</th>
                  <th className={th}>位置</th>
                  <th className={th}>嚴重度</th>
                  <th className={th}>可能來源</th>
                </tr>
              </thead>
              <tbody>
                {report.observedIssues.map((o) => (
                  <tr key={`${o.issue}-${o.location}`} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className={`${td} font-medium`}>{o.issue}</td>
                    <td className={td}>{o.location}</td>
                    <td className={`${td} whitespace-nowrap ${SEVERITY_TONE[o.severity]}`}>{SEVERITIES[o.severity]}</td>
                    <td className={td}>
                      <CategoryTag category={o.category} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 改善順序 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">建議的改善順序</h2>
        <ol className="flex flex-col gap-2">
          {report.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-medium text-background">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.title}</span>
                  <CategoryTag category={s.category} />
                  <span className="text-xs text-zinc-500">{EFFORTS[s.effort]}</span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 改善對照表 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">改善對照表</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-foreground/5 text-zinc-500">
              <tr>
                <th className={th}>改善方向</th>
                <th className={th}>實物可能出現的問題</th>
                <th className={th}>建議的調整</th>
                <th className={th}>類別</th>
              </tr>
            </thead>
            <tbody>
              {report.table.map((row) => (
                <tr key={row.direction} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className={`${td} font-medium`}>{row.direction}</td>
                  <td className={td}>{row.problem}</td>
                  <td className={td}>{row.adjustment}</td>
                  <td className={td}>
                    <CategoryTag category={row.category} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 修正檔 */}
      <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">修正後的 Bambu Studio 檔案</h2>
        {review.fixedFileUrl ? (
          <>
            <p className="text-sm text-zinc-500">
              已套用 {review.applied.length} 項設定修改；模型、擺放和其他設定都沒有變動。材料、機器和模型方面的建議請依上面的改善順序處理。
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={downloadUrl(review.fixedFileUrl)} className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background">
                下載修正後的 3MF
              </a>
              <a href={downloadUrl(review.sourceFileUrl)} className="rounded-full border border-zinc-300 px-5 py-2 text-sm dark:border-zinc-700">
                下載當初列印的檔案
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">這次的問題不需要改列印設定（主要來自材料、機器或模型），所以沒有產生修正檔。</p>
        )}
        {(review.applied.length > 0 || review.rejected.length > 0) && (
          <SettingChangesTable applied={review.applied} rejected={review.rejected} changes={report.changes} settings={review.settings} />
        )}
      </section>

      {report.photoTips.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg bg-foreground/5 p-4 text-sm">
          <p className="font-medium">想讓判斷更準，可以再拍：</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {report.photoTips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 依據 */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <p className="font-medium">你提供的狀況</p>
          <p>看到的問題：{described.symptoms.join("、") || "沒有勾選"}</p>
          {described.conditions
            .filter((c) => c.value !== "不確定")
            .map((c) => (
              <p key={c.label}>
                {c.label}：{c.value}
              </p>
            ))}
          {described.environment.length > 0 && <p>環境：{described.environment.join("、")}</p>}
          {described.notes && <p>補充：{described.notes}</p>}
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <p className="font-medium">當初列印的模型</p>
          <div className="grid grid-cols-4 gap-1">
            {review.snapshotUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" className="aspect-square w-full rounded" />
            ))}
          </div>
          <p className="text-zinc-500">
            {review.settings.find((s) => s.key === "printer_settings_id")?.value}・
            {review.settings.find((s) => s.key === "filament_settings_id")?.value}
          </p>
        </div>
      </section>

      <p className="text-xs text-zinc-500">
        由 {review.aiModel} 分析。AI 只能判斷照片裡看得到的現象，結果可能有誤；改完後建議先印一個小樣確認。
      </p>
    </div>
  );
}

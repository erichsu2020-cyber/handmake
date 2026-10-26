import SettingChangesTable from "@/components/SettingChangesTable";
import { downloadUrl } from "@/lib/blob-url";
import {
  CHECK_CATEGORIES,
  ENVIRONMENTS,
  PRIORITIES,
  RATINGS,
  VERDICTS,
  type Rating,
} from "@/lib/print-check-settings";
import type { PrintCheckView } from "@/lib/print-checks";

// AI 列印檢查的報告（伺服器元件）

const TONE = {
  good: "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
  warning: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  problem: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
} as const;

const RATING_TONE: Record<Rating, keyof typeof TONE> = { good: "good", warning: "warning", problem: "problem" };

const labels = (list: readonly { value: string; label: string }[], values: string[]) =>
  values.map((v) => list.find((o) => o.value === v)?.label ?? v).join("、");

export default function PrintCheckReport({ check }: { check: PrintCheckView }) {
  const { report, geometry: g, estimate: e, requirements: r } = check;
  const verdict = VERDICTS[report.verdict];

  return (
    <div className="flex flex-col gap-6">
      {/* 結論 */}
      <section className={`flex flex-col gap-2 rounded-lg border p-4 ${TONE[verdict.tone]}`}>
        <p className="text-lg font-semibold">{verdict.label}</p>
        <p>{report.summary}</p>
      </section>

      {/* 下載 */}
      <section className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">修正後的 Bambu Studio 檔案</h2>
        {check.fixedFileUrl ? (
          <>
            <p className="text-sm text-zinc-500">
              已套用下方 {check.applied.length} 項設定修改；模型、擺放和其他設定都沒有變動。用 Bambu Studio 打開，如果詢問是否載入專案設定請選「是」。
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={downloadUrl(check.fixedFileUrl)}
                className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
              >
                下載修正後的 3MF
              </a>
              <a href={downloadUrl(check.sourceFileUrl)} className="rounded-full border border-zinc-300 px-5 py-2 text-sm dark:border-zinc-700">
                下載原始檔
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">AI 認為目前的設定不需要修改，所以沒有產生修正檔。</p>
        )}
      </section>

      {/* 設定對照 */}
      {(check.applied.length > 0 || check.rejected.length > 0) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">設定修改</h2>
          <SettingChangesTable applied={check.applied} rejected={check.rejected} changes={report.changes} settings={check.settings} />
        </section>
      )}

      {/* 五個面向 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">檢查結果</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHECK_CATEGORIES.map((c) => {
            const item = report.categories.find((x) => x.id === c.id);
            if (!item) return null;
            return (
              <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.label}</span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs ${TONE[RATING_TONE[item.rating]]}`}>
                    {RATINGS[item.rating]}
                  </span>
                </div>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {item.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* 無法自動修改的建議 */}
      {report.manualAdvice.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">需要手動處理的建議</h2>
          <ul className="flex flex-col gap-2">
            {report.manualAdvice.map((a) => (
              <li key={a.title} className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
                <p className="font-medium">{a.title}</p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">{a.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 依據 */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <p className="font-medium">產品需求</p>
          <p>用途：{r.purpose}</p>
          <p>
            數量：{r.quantity} 個{r.budgetPerPiece !== undefined && `・每個預算 NT$${r.budgetPerPiece}`}
          </p>
          <p>最在意：{labels(PRIORITIES, r.priorities)}</p>
          <p>使用環境：{labels(ENVIRONMENTS, r.environments) || "未指定"}</p>
          {r.notes && <p>補充：{r.notes}</p>}
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <p className="font-medium">模型數據與粗估（單一個）</p>
          <p>
            尺寸：{g.sizeMm.join(" × ")} mm{g.fitsBed === false && "（放不進平台！）"}
          </p>
          <p>
            體積 {g.volumeCm3} cm³・懸空比例 {(g.overhangRatio * 100).toFixed(1)}%・貼平台 {g.baseContactAreaMm2} mm²
          </p>
          <p>
            網格：{g.openEdges === 0 && g.nonManifoldEdges === 0 ? "封閉、沒有錯誤" : `破洞邊 ${g.openEdges}、錯誤邊 ${g.nonManifoldEdges}`}
            {g.floatingMm > 0 && `・離平台 ${g.floatingMm} mm`}
          </p>
          <p>
            {e.material} 約 {e.grams.toFixed(0)} g・約 {e.hours.toFixed(1)} 小時・材料費約 NT${e.cost.toFixed(0)}
          </p>
          <p className="text-xs text-zinc-500">時間、成本是修改前的粗估，實際以 Bambu Studio 切片結果為準。</p>
        </div>
      </section>

      {check.snapshotUrls.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">AI 看到的模型截圖</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {check.snapshotUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" className="aspect-square w-full rounded-lg border border-zinc-300 dark:border-zinc-700" />
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-zinc-500">
        由 {check.aiModel} 分析。AI 的判斷可能有誤，請在 Bambu Studio 切片後確認預覽，再開始列印。
      </p>
    </div>
  );
}

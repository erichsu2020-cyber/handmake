import type { AppliedChange, RejectedChange, SettingRow } from "@/lib/bambu-project";
import { formatSettingValue } from "@/lib/print-check-settings";

// 「AI 列印檢查」「成品改良」報告共用：設定｜目前設定｜建議設定｜修改原因
export default function SettingChangesTable({
  applied,
  rejected,
  changes,
  settings,
}: {
  applied: AppliedChange[];
  rejected: RejectedChange[];
  // AI 建議的原始內容（取修改原因）
  changes: { key: string; reason: string }[];
  // 取單位和中文名稱
  settings: SettingRow[];
}) {
  const reasonOf = (key: string) => changes.find((c) => c.key === key)?.reason ?? "";
  const unit = (key: string) => settings.find((s) => s.key === key)?.unit ?? "";

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-foreground/5 text-zinc-500">
          <tr>
            <th className="p-2.5 font-normal">設定</th>
            <th className="p-2.5 font-normal">目前設定</th>
            <th className="p-2.5 font-normal">建議設定</th>
            <th className="p-2.5 font-normal">修改原因</th>
          </tr>
        </thead>
        <tbody>
          {applied.map((a) => (
            <tr key={a.key} className="border-t border-zinc-200 align-top dark:border-zinc-800">
              <td className="whitespace-nowrap p-2.5 font-medium">{a.label}</td>
              <td className="whitespace-nowrap p-2.5 text-zinc-500">
                {formatSettingValue(a.key, a.from)}
                {a.from !== "（預設）" && unit(a.key)}
              </td>
              <td className="whitespace-nowrap p-2.5 font-medium text-accent">
                {formatSettingValue(a.key, a.to)}
                {unit(a.key)}
              </td>
              <td className="p-2.5">{reasonOf(a.key)}</td>
            </tr>
          ))}
          {rejected.map((x) => (
            <tr key={`rejected-${x.key}-${x.value}`} className="border-t border-zinc-200 align-top text-zinc-500 dark:border-zinc-800">
              <td className="p-2.5">{settings.find((s) => s.key === x.key)?.label ?? x.key}</td>
              <td className="p-2.5" colSpan={2}>
                未套用：AI 建議 {formatSettingValue(x.key, x.value)}，但{x.reason}
              </td>
              <td className="p-2.5">{reasonOf(x.key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

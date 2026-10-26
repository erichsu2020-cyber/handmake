import type { Guide } from "@/lib/bambu-guide";

// 參數說明卡：用途 → 選項比較表 → 建議
// highlight：表格第一欄等於這個值的那一列會標示出來（例如目前選的層高），括號裡的補充說明不算
const plain = (text: string) => text.split("（")[0].trim();

export default function BambuGuide({
  guide,
  highlight,
}: {
  guide: Guide;
  highlight?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-foreground/5 p-3 text-sm">
      <p>{guide.purpose}</p>
      {guide.table && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left">
            <thead>
              <tr className="text-zinc-500">
                {guide.table.head.map((h) => (
                  <th key={h} className="py-1 pr-4 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.table.rows.map((row) => (
                <tr
                  key={row[0]}
                  className={`border-t border-zinc-200 dark:border-zinc-800 ${
                    highlight !== undefined && plain(row[0]) === plain(highlight) ? "font-medium text-accent" : ""
                  }`}
                >
                  {row.map((cell, i) => (
                    <td key={i} className="py-1 pr-4">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {guide.tips && (
        <ul className="flex flex-col gap-1">
          {guide.tips.map((tip) => (
            <li key={tip}>💡 {tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

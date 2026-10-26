"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/form-controls";
import { readBambuProject } from "@/lib/bambu-project-read";
import { renderSnapshots, type Snapshot } from "@/lib/model-snapshots";

// 「AI 列印檢查」「成品改良」共用：選 Bambu 檔（網站上的或從電腦上傳）→ 在瀏覽器讀出模型和設定 → 拍 4 張 3D 截圖

export type BambuFileOption = {
  type: "generation" | "upload" | "check";
  id: string;
  name: string;
  fileUrl: string;
  imageUrl?: string;
  summary: string; // 例如「Bambu Lab H2S・0.4 mm・PETG HF・層高 0.16」
};

export type PickedBambuFile = { kind: "site"; option: BambuFileOption } | { kind: "file"; file: File };

export const MAX_BAMBU_FILE_BYTES = 50 * 1024 * 1024;

export default function BambuSourcePicker({
  groups,
  onChange,
}: {
  // 依來源分組顯示，例如「Bambu 設定頁產生的檔案」「AI 列印檢查的修正檔」
  groups: { label: string; options: BambuFileOption[] }[];
  // 讀好、拍好截圖才回傳；換檔案或讀取失敗時回傳 null
  onChange: (picked: { file: PickedBambuFile; snapshots: Snapshot[] } | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<PickedBambuFile | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [projectInfo, setProjectInfo] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 換檔案時釋放舊截圖的網址
  useEffect(() => () => snapshots.forEach((s) => URL.revokeObjectURL(s.url)), [snapshots]);

  async function choose(next: PickedBambuFile) {
    setSelected(next);
    setSnapshots([]);
    setProjectInfo(null);
    setError(null);
    onChange(null);
    try {
      if (next.kind === "file") {
        if (!next.file.name.toLowerCase().endsWith(".3mf")) throw new Error("請選擇 Bambu Studio 的 .3mf 專案檔");
        if (next.file.size > MAX_BAMBU_FILE_BYTES) throw new Error(`檔案不能超過 ${MAX_BAMBU_FILE_BYTES / 1024 / 1024}MB`);
      }
      setPreparing(true);
      const bytes =
        next.kind === "site"
          ? new Uint8Array(await (await fetch(next.option.fileUrl)).arrayBuffer())
          : new Uint8Array(await next.file.arrayBuffer());
      const project = readBambuProject(bytes);
      if (!project.config) {
        throw new Error("這個 3MF 沒有 Bambu Studio 設定。請在 Bambu Studio 用「另存專案」存成 3MF，或先到「Bambu 設定」產生");
      }
      const c = project.config;
      const first = (v: unknown) => String(Array.isArray(v) ? v[0] : (v ?? ""));
      setProjectInfo(
        [first(c.printer_settings_id), first(c.filament_settings_id), c.layer_height && `層高 ${first(c.layer_height)} mm`, `${project.objectCount} 個物件`]
          .filter(Boolean)
          .join("・"),
      );
      const shots = await renderSnapshots(project.meshes);
      setSnapshots(shots);
      onChange({ file: next, snapshots: shots });
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取檔案失敗");
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm ${active ? "border-foreground bg-foreground text-background" : "border-zinc-300 dark:border-zinc-700"}`;
  const name = selected ? (selected.kind === "site" ? selected.option.name : selected.file.name) : "";

  return (
    <>
      {groups
        .filter((g) => g.options.length > 0)
        .map((g) => (
          <Field key={g.label} label={g.label}>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {g.options.map((s) => {
                const active = selected?.kind === "site" && selected.option.type === s.type && selected.option.id === s.id;
                return (
                  <li key={`${s.type}:${s.id}`}>
                    <button
                      type="button"
                      onClick={() => choose({ kind: "site", option: s })}
                      className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left text-sm ${
                        active ? "border-foreground ring-2 ring-foreground" : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    >
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded bg-white object-contain" />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-900">
                          3MF
                        </span>
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="line-clamp-1 font-medium">{s.name}</span>
                        <span className="line-clamp-2 text-xs text-zinc-500">{s.summary}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Field>
        ))}
      <Field label="或從電腦上傳" hint="Bambu Studio 的 .3mf 專案檔（檔案 → 另存專案），50MB 以內">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className={chip(selected?.kind === "file")}>
            {selected?.kind === "file" ? `已選擇：${selected.file.name}` : "選擇 3MF 檔"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".3mf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && choose({ kind: "file", file: e.target.files[0] })}
          />
        </div>
      </Field>

      {preparing && <p className="text-sm text-zinc-500">讀取模型並拍攝 3D 截圖中…</p>}
      {error && <p className="rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</p>}
      {selected && snapshots.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="font-medium">{name}</span>
            {projectInfo && <span className="text-zinc-500">・{projectInfo}</span>}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {snapshots.map((s) => (
              <figure key={s.id} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.label} className="aspect-square w-full rounded-lg border border-zinc-300 dark:border-zinc-700" />
                <figcaption className="text-center text-xs text-zinc-500">{s.label}</figcaption>
              </figure>
            ))}
          </div>
          <p className="text-xs text-zinc-500">AI 會看到這 4 張 3D 截圖，格線是列印平台。</p>
        </div>
      )}
    </>
  );
}

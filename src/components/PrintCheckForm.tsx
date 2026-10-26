"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BambuSourcePicker, { type BambuFileOption, type PickedBambuFile } from "@/components/BambuSourcePicker";
import { Field, Section } from "@/components/form-controls";
import { readJson, uploadToBlob, useElapsedSeconds } from "@/lib/analysis-client";
import type { Snapshot } from "@/lib/model-snapshots";
import {
  DEFAULT_REQUIREMENTS,
  ENVIRONMENTS,
  PRINT_CHECK_SNAPSHOT_FOLDER,
  PRINT_CHECK_UPLOAD_FOLDER,
  PRIORITIES,
  parseRequirements,
  type Environment,
  type Priority,
  type PrintRequirements,
} from "@/lib/print-check-settings";

// 「AI 列印檢查」表單：選 Bambu 檔 → 自動拍 4 張截圖 → 填需求 → 送出（AI 約需 1–3 分鐘）→ 跳到報告

export default function PrintCheckForm({ sources }: { sources: BambuFileOption[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<{ file: PickedBambuFile; snapshots: Snapshot[] } | null>(null);
  const [requirements, setRequirements] = useState<PrintRequirements>(DEFAULT_REQUIREMENTS);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const elapsed = useElapsedSeconds(phase === "analyzing");
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PrintRequirements>(key: K, value: PrintRequirements[K]) =>
    setRequirements((r) => ({ ...r, [key]: value }));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked) {
      setError("請先選擇要檢查的檔案");
      return;
    }
    const parsed = parseRequirements(requirements);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setError(null);
    setPhase("uploading");
    try {
      const { file, snapshots } = picked;
      const [fileUrl, ...snapshotUrls] = await Promise.all([
        file.kind === "file" ? uploadToBlob(`${PRINT_CHECK_UPLOAD_FOLDER}project.3mf`, file.file, "model/3mf") : null,
        ...snapshots.map((s) => uploadToBlob(`${PRINT_CHECK_SNAPSHOT_FOLDER}${s.id}.jpg`, s.blob, "image/jpeg")),
      ]);

      setPhase("analyzing");
      const res = await fetch("/api/print-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source:
            file.kind === "site"
              ? { type: file.option.type, id: file.option.id }
              : { type: "file", url: fileUrl, name: file.file.name },
          requirements: parsed,
          snapshotUrls,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "檢查失敗");
      router.push(`/print-checks/${data.check.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "檢查失敗");
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm ${active ? "border-foreground bg-foreground text-background" : "border-zinc-300 dark:border-zinc-700"}`;

  // 在意項目依點選順序排列，第一個最重要
  function togglePriority(p: Priority) {
    set("priorities", requirements.priorities.includes(p) ? requirements.priorities.filter((x) => x !== p) : [...requirements.priorities, p]);
  }
  function toggleEnvironment(env: Environment) {
    set(
      "environments",
      requirements.environments.includes(env) ? requirements.environments.filter((x) => x !== env) : [...requirements.environments, env],
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="1. 選擇 Bambu Studio 檔案" disabled={busy}>
        <BambuSourcePicker groups={[{ label: "「Bambu 設定」頁產生過的檔案", options: sources }]} onChange={setPicked} />
      </Section>

      <Section title="2. 產品需求" disabled={busy}>
        <Field label="這是什麼？拿來做什麼？（必填）">
          <textarea
            value={requirements.purpose}
            onChange={(e) => set("purpose", e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="例如：桌上擺飾的小貓公仔，要送人／機車手機架，要能承受震動"
            className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
          />
        </Field>
        <div className="flex flex-wrap gap-6">
          <Field label="數量">
            <input
              type="number"
              min={1}
              value={requirements.quantity}
              onChange={(e) => set("quantity", Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-28 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
            />
          </Field>
          <Field label="每個預算（選填）">
            <span className="flex items-center gap-2">
              NT$
              <input
                type="number"
                min={0}
                value={requirements.budgetPerPiece ?? ""}
                onChange={(e) => set("budgetPerPiece", e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)))}
                className="w-28 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
              />
            </span>
          </Field>
        </div>
        <Field label="最在意什麼？（可複選，依點選順序代表優先順序）">
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => {
              const order = requirements.priorities.indexOf(p.value);
              return (
                <button key={p.value} type="button" onClick={() => togglePriority(p.value)} className={chip(order >= 0)}>
                  {order >= 0 && `${order + 1}. `}
                  {p.label}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="使用環境（可複選）">
          <div className="flex flex-wrap gap-2">
            {ENVIRONMENTS.map((env) => (
              <button
                key={env.value}
                type="button"
                onClick={() => toggleEnvironment(env.value)}
                className={chip(requirements.environments.includes(env.value))}
              >
                {env.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="補充說明（選填）">
          <textarea
            value={requirements.notes}
            onChange={(e) => set("notes", e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="例如：臉部是重點、可以接受支撐痕跡、要放在窗邊"
            className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
          />
        </Field>
      </Section>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || !picked}
        className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
      >
        {phase === "uploading"
          ? "上傳中…"
          : phase === "analyzing"
            ? `AI 分析中…已經過 ${elapsed} 秒（約需 1–3 分鐘，請不要關閉頁面）`
            : "開始 AI 檢查"}
      </button>
      <p className="text-center text-xs text-zinc-500">每次檢查會使用 OpenAI 點數。AI 的判斷僅供參考，請以 Bambu Studio 的切片預覽確認。</p>
    </form>
  );
}

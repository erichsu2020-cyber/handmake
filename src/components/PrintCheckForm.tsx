"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Field, Section } from "@/components/form-controls";
import { readBambuProject } from "@/lib/bambu-project-read";
import { renderSnapshots, type Snapshot } from "@/lib/model-snapshots";
import {
  DEFAULT_REQUIREMENTS,
  ENVIRONMENTS,
  MAX_PRINT_CHECK_UPLOAD_BYTES,
  PRINT_CHECK_SNAPSHOT_FOLDER,
  PRINT_CHECK_UPLOAD_FOLDER,
  PRIORITIES,
  parseRequirements,
  type Environment,
  type Priority,
  type PrintRequirements,
} from "@/lib/print-check-settings";

// 「AI 列印檢查」表單：選 Bambu 檔 → 自動拍 4 張截圖 → 填需求 → 送出（AI 約需 1–3 分鐘）→ 跳到報告

export type CheckSourceOption = {
  type: "generation" | "upload";
  id: string;
  name: string;
  fileUrl: string;
  imageUrl?: string;
  summary: string; // 例如「Bambu Lab H2S・0.4 mm・PETG HF・層高 0.16」
};

type Selected = { kind: "site"; option: CheckSourceOption } | { kind: "file"; file: File };

const name = (s: Selected) => (s.kind === "site" ? s.option.name : s.file.name);

export default function PrintCheckForm({ sources }: { sources: CheckSourceOption[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [projectInfo, setProjectInfo] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [requirements, setRequirements] = useState<PrintRequirements>(DEFAULT_REQUIREMENTS);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PrintRequirements>(key: K, value: PrintRequirements[K]) =>
    setRequirements((r) => ({ ...r, [key]: value }));

  // 換檔案時釋放舊截圖的網址
  useEffect(() => () => snapshots.forEach((s) => URL.revokeObjectURL(s.url)), [snapshots]);

  // AI 分析中：每秒更新經過時間
  useEffect(() => {
    if (phase !== "analyzing") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // 選好檔案：在瀏覽器讀出模型和設定，拍 4 張截圖（跟送給 AI 的一樣）
  async function choose(next: Selected) {
    setSelected(next);
    setSnapshots([]);
    setProjectInfo(null);
    setError(null);
    if (next.kind === "file") {
      if (!next.file.name.toLowerCase().endsWith(".3mf")) {
        setError("請選擇 Bambu Studio 的 .3mf 專案檔");
        return;
      }
      if (next.file.size > MAX_PRINT_CHECK_UPLOAD_BYTES) {
        setError(`檔案不能超過 ${MAX_PRINT_CHECK_UPLOAD_BYTES / 1024 / 1024}MB`);
        return;
      }
    }
    setPreparing(true);
    try {
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
      setSnapshots(await renderSnapshots(project.meshes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取檔案失敗");
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || snapshots.length === 0) {
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
      // 檔案和截圖直接從瀏覽器上傳到 Vercel Blob，不經過伺服器（Vercel 函式的請求上限只有 4.5MB）
      const put = (path: string, body: Blob, contentType: string) =>
        upload(path, body, { access: "public", handleUploadUrl: "/api/blob-upload", contentType }).then((b) => b.url);
      const [fileUrl, ...snapshotUrls] = await Promise.all([
        selected.kind === "file" ? put(`${PRINT_CHECK_UPLOAD_FOLDER}project.3mf`, selected.file, "model/3mf") : null,
        ...snapshots.map((s) => put(`${PRINT_CHECK_SNAPSHOT_FOLDER}${s.id}.jpg`, s.blob, "image/jpeg")),
      ]);

      setPhase("analyzing");
      setElapsed(0);
      const res = await fetch("/api/print-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source:
            selected.kind === "site"
              ? { type: selected.option.type, id: selected.option.id }
              : { type: "file", url: fileUrl, name: selected.file.name },
          requirements: parsed,
          snapshotUrls,
        }),
      });
      const data = await res.json().catch(() => ({ error: `伺服器沒有回應 (${res.status})，可能是分析太久被中斷，請再試一次` }));
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
        {sources.length > 0 && (
          <Field label="「Bambu 設定」頁產生過的檔案">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sources.map((s) => {
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
        )}
        <Field label="或從電腦上傳" hint="Bambu Studio 的 .3mf 專案檔（檔案 → 另存專案），50MB 以內">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={chip(selected?.kind === "file")}
            >
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

        {preparing && <p className="text-sm text-zinc-500">讀取模型並拍攝截圖中…</p>}
        {selected && snapshots.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-medium">{name(selected)}</span>
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
            <p className="text-xs text-zinc-500">AI 會看到這 4 張截圖，格線是列印平台。</p>
          </div>
        )}
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
        disabled={busy || preparing}
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

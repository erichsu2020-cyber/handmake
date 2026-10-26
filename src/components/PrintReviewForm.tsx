"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BambuSourcePicker, { type BambuFileOption, type PickedBambuFile } from "@/components/BambuSourcePicker";
import { Field, Section } from "@/components/form-controls";
import { readJson, resizePhoto, uploadToBlob, useElapsedSeconds } from "@/lib/analysis-client";
import type { Snapshot } from "@/lib/model-snapshots";
import {
  CONDITIONS,
  DEFAULT_DETAILS,
  ENVIRONMENT_CONDITIONS,
  MAX_PHOTOS,
  PHOTO_MAX_EDGE,
  PRINT_REVIEW_PHOTO_FOLDER,
  PRINT_REVIEW_SNAPSHOT_FOLDER,
  PRINT_REVIEW_UPLOAD_FOLDER,
  SYMPTOMS,
  parseDetails,
  type ConditionKey,
  type ReviewDetails,
} from "@/lib/print-review-settings";

// 「成品改良」表單：成品照片 → 當初列印的 Bambu 檔（自動拍 3D 截圖）→ 狀況描述（選填）→ AI 分析 → 報告

type Photo = { id: string; name: string; blob: Blob; url: string };

export default function PrintReviewForm({
  siteFiles,
  checkFiles,
}: {
  siteFiles: BambuFileOption[];
  checkFiles: BambuFileOption[];
}) {
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<{ file: PickedBambuFile; snapshots: Snapshot[] } | null>(null);
  const [details, setDetails] = useState<ReviewDetails>(DEFAULT_DETAILS);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const elapsed = useElapsedSeconds(phase === "analyzing");
  const [error, setError] = useState<string | null>(null);

  // 離開頁面時釋放照片預覽的網址
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function addPhotos(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (list.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(`照片最多 ${MAX_PHOTOS} 張`);
      return;
    }
    setAddingPhotos(true);
    setError(list.length > room ? `照片最多 ${MAX_PHOTOS} 張，只加入前 ${room} 張` : null);
    try {
      const added: Photo[] = [];
      for (const file of list.slice(0, room)) {
        const blob = await resizePhoto(file, PHOTO_MAX_EDGE);
        added.push({ id: Math.random().toString(36).slice(2), name: file.name, blob, url: URL.createObjectURL(blob) });
      }
      setPhotos((p) => [...p, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取照片失敗");
    } finally {
      setAddingPhotos(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  function removePhoto(id: string) {
    setPhotos((list) => {
      const target = list.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return list.filter((p) => p.id !== id);
    });
  }

  const toggle = <T extends string>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (photos.length === 0) {
      setError("請至少上傳一張成品照片");
      return;
    }
    if (!picked) {
      setError("請選擇當初列印的 Bambu Studio 檔案");
      return;
    }
    const parsed = parseDetails(details);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setError(null);
    setPhase("uploading");
    try {
      const { file, snapshots } = picked;
      const [fileUrl, photoUrls, snapshotUrls] = await Promise.all([
        file.kind === "file" ? uploadToBlob(`${PRINT_REVIEW_UPLOAD_FOLDER}project.3mf`, file.file, "model/3mf") : null,
        Promise.all(photos.map((p, i) => uploadToBlob(`${PRINT_REVIEW_PHOTO_FOLDER}photo-${i + 1}.jpg`, p.blob, "image/jpeg"))),
        Promise.all(snapshots.map((s) => uploadToBlob(`${PRINT_REVIEW_SNAPSHOT_FOLDER}${s.id}.jpg`, s.blob, "image/jpeg"))),
      ]);

      setPhase("analyzing");
      const res = await fetch("/api/print-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source:
            file.kind === "site"
              ? { type: file.option.type, id: file.option.id }
              : { type: "file", url: fileUrl, name: file.file.name },
          details: parsed,
          photoUrls,
          snapshotUrls,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "分析失敗");
      router.push(`/print-reviews/${data.review.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失敗");
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm ${active ? "border-foreground bg-foreground text-background" : "border-zinc-300 dark:border-zinc-700"}`;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="1. 成品照片（必填）" disabled={busy}>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!addingPhotos) addPhotos(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center ${
            dragging ? "border-foreground bg-foreground/5" : "border-zinc-300 dark:border-zinc-700"
          } ${addingPhotos || photos.length >= MAX_PHOTOS ? "pointer-events-none opacity-50" : ""}`}
        >
          <span className="font-medium">{addingPhotos ? "處理照片中…" : "選擇照片，或拖曳到這裡"}</span>
          <span className="text-sm text-zinc-500">
            {photos.length}/{MAX_PHOTOS} 張・建議一張整體照，再加上問題部位的特寫（光線充足、對焦清楚）
          </span>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => e.target.files && addPhotos(e.target.files)}
            className="sr-only"
          />
        </label>
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {photos.map((p, i) => (
              <li key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name} className="aspect-square w-full rounded-lg border border-zinc-300 object-cover dark:border-zinc-700" />
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  aria-label={`移除第 ${i + 1} 張照片`}
                  className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-xs text-white"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="2. 當初列印的 Bambu Studio 檔案（必選）" disabled={busy}>
        <BambuSourcePicker
          groups={[
            { label: "「Bambu 設定」頁產生過的檔案", options: siteFiles },
            { label: "「AI 列印檢查」的檔案（有修正版就用修正版）", options: checkFiles },
          ]}
          onChange={setPicked}
        />
      </Section>

      <Section title="3. 補充狀況（選填，填越多判斷越準）" disabled={busy}>
        <Field label="看到哪些問題？（可複選）">
          <div className="flex flex-wrap gap-2">
            {SYMPTOMS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setDetails((d) => ({ ...d, symptoms: toggle(d.symptoms, s.value) }))}
                className={chip(details.symptoms.includes(s.value))}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(CONDITIONS) as ConditionKey[]).map((key) => (
            <Field key={key} label={CONDITIONS[key].label}>
              <select
                value={details.conditions[key]}
                onChange={(e) => setDetails((d) => ({ ...d, conditions: { ...d.conditions, [key]: e.target.value } }))}
                className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
              >
                {CONDITIONS[key].options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>

        <Field label="列印環境（可複選）">
          <div className="flex flex-wrap gap-2">
            {ENVIRONMENT_CONDITIONS.map((env) => (
              <button
                key={env.value}
                type="button"
                onClick={() => setDetails((d) => ({ ...d, environment: toggle(d.environment, env.value) }))}
                className={chip(details.environment.includes(env.value))}
              >
                {env.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="補充說明">
          <textarea
            value={details.notes}
            onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))}
            maxLength={1000}
            rows={3}
            placeholder="例如：耳朵尖端很多細絲、底部第一層有一角翹起來、這是第二次印"
            className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
          />
        </Field>
      </Section>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || addingPhotos}
        className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
      >
        {phase === "uploading"
          ? "上傳中…"
          : phase === "analyzing"
            ? `AI 分析中…已經過 ${elapsed} 秒（約需 1–3 分鐘，請不要關閉頁面）`
            : "開始 AI 分析"}
      </button>
      <p className="text-center text-xs text-zinc-500">每次分析會使用 OpenAI 點數。AI 只能從照片判斷看得到的現象，結果僅供參考。</p>
    </form>
  );
}

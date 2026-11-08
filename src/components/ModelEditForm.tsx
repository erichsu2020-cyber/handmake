"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SnapshotGrid } from "@/components/ModelEditResult";
import { Check, Chips, Field, Section } from "@/components/form-controls";
import { readJson, uploadToBlob, useElapsedSeconds } from "@/lib/analysis-client";
import { readBambuProject } from "@/lib/bambu-project-read";
import { boundsSize, meshBounds, type MeshData } from "@/lib/mesh";
import { SNAPSHOT_VIEWS, renderSnapshots, type Snapshot } from "@/lib/model-snapshots";
import {
  DEFAULT_STEM,
  MAX_MODEL_EDIT_UPLOAD_BYTES,
  MODEL_EDIT_SNAPSHOT_FOLDER,
  MODEL_EDIT_UPLOAD_FOLDER,
  STEM_FIELDS,
  STEM_MODES,
  parseEditRequest,
  splitLayout,
  stemClearanceHeight,
  type EditRequest,
  type ResizeMode,
  type StemMode,
  type StemSpec,
} from "@/lib/model-edit-settings";

// 「AI 改模型」：上傳 3MF → 選要改的項目 → AI 決定參數、程式修改網格 → 跳到修改紀錄

const RESIZE_OPTIONS: { value: ResizeMode; label: string }[] = [
  { value: "keep", label: "不改尺寸" },
  { value: "exact", label: "指定尺寸" },
  { value: "ai", label: "交給 AI（依需求說明）" },
];
const AXES = ["寬（X）", "深（Y）", "高（Z）"];
const STEM_MODE_OPTIONS = [
  ...Object.entries(STEM_MODES).map(([value, label]) => ({ value, label })),
  { value: "auto", label: "交給 AI 選" },
];

type Picked = { file: File; meshes: MeshData[]; sizeMm: [number, number, number]; info: string; snapshots: Snapshot[] };

const mm = (v: number[]) => v.map((x) => x.toFixed(1)).join(" × ");

export default function ModelEditForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("keep");
  const [size, setSize] = useState<[number, number, number]>([0, 0, 0]);
  const [keepRatio, setKeepRatio] = useState(true);
  const [stemOn, setStemOn] = useState(true);
  const [stem, setStem] = useState<StemSpec>(DEFAULT_STEM);
  const [stemMode, setStemMode] = useState<StemMode | "auto">("split");
  // 切割高度：空字串代表交給 AI
  const [cutHeight, setCutHeight] = useState("");
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "working">("idle");
  const elapsed = useElapsedSeconds(phase === "working");
  const [error, setError] = useState<string | null>(null);

  // 換檔案時釋放舊截圖的網址
  useEffect(() => () => picked?.snapshots.forEach((s) => URL.revokeObjectURL(s.url)), [picked]);

  async function choose(file: File) {
    setPicked(null);
    setError(null);
    try {
      if (!file.name.toLowerCase().endsWith(".3mf")) throw new Error("請選擇 .3mf 檔");
      if (file.size > MAX_MODEL_EDIT_UPLOAD_BYTES) throw new Error("檔案不能超過 50MB");
      setPreparing(true);
      const project = readBambuProject(new Uint8Array(await file.arrayBuffer()));
      const sizeMm = boundsSize(meshBounds(project.meshes));
      const printer = project.config?.printer_settings_id;
      const info = [`${project.objectCount} 個物件`, printer ? `Bambu 專案（${String(printer)}），會保留列印設定` : "一般 3MF（沒有 Bambu 設定）"].join("・");
      setSize(sizeMm.map((v) => Math.round(v * 10) / 10) as [number, number, number]);
      setPicked({ file, meshes: project.meshes, sizeMm, info, snapshots: await renderSnapshots(project.meshes) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取檔案失敗");
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // 等比例：改一個軸，另外兩個跟著同倍率
  function setAxis(k: number, value: number) {
    if (!picked) return;
    if (keepRatio && value > 0) {
      const ratio = value / picked.sizeMm[k];
      setSize(picked.sizeMm.map((v, i) => (i === k ? value : Math.round(v * ratio * 10) / 10)) as [number, number, number]);
    } else {
      setSize((s) => s.map((v, i) => (i === k ? value : v)) as [number, number, number]);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked) {
      setError("請先選擇 3MF 檔");
      return;
    }
    const request: EditRequest = {
      resize: { mode: resizeMode, sizeMm: resizeMode === "exact" ? size : undefined },
      stem: stemOn ? stem : null,
      stemMode,
      cutHeightMm: stemOn && stemMode === "split" && cutHeight !== "" ? Number(cutHeight) : undefined,
      notes,
    };
    const parsed = parseEditRequest(request);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setError(null);
    setPhase("uploading");
    try {
      const [fileUrl, ...snapshotUrls] = await Promise.all([
        uploadToBlob(`${MODEL_EDIT_UPLOAD_FOLDER}model.3mf`, picked.file, "model/3mf"),
        ...picked.snapshots.map((s) => uploadToBlob(`${MODEL_EDIT_SNAPSHOT_FOLDER}${s.id}.jpg`, s.blob, "image/jpeg")),
      ]);
      setPhase("working");
      const res = await fetch("/api/model-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl, name: picked.file.name, request: parsed, snapshotUrls }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "修改失敗");
      router.push(`/model-edits/${data.edit.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失敗");
      setPhase("idle");
    }
  }

  const busy = phase !== "idle" || preparing;
  const input = "w-24 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="1. 上傳 3MF" disabled={busy}>
        <Field label="模型檔" hint="Bambu Studio 專案或一般 3MF，50MB 以內；十字孔做在模型目前的底部（貼平台那面）">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-zinc-300 px-3.5 py-1.5 text-sm dark:border-zinc-700"
            >
              {picked ? `已選擇：${picked.file.name}` : "選擇 3MF 檔"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".3mf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])}
            />
          </div>
        </Field>
        {preparing && <p className="text-sm text-zinc-500">讀取模型並拍攝 3D 截圖中…</p>}
        {picked && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              目前尺寸 <span className="font-medium">{mm(picked.sizeMm)} mm</span>
              <span className="text-zinc-500">・{picked.info}</span>
            </p>
            <SnapshotGrid snapshots={picked.snapshots} />
          </div>
        )}
      </Section>

      <Section title="2. 尺寸" disabled={busy || !picked}>
        <Chips options={RESIZE_OPTIONS} value={resizeMode} onChange={(v) => setResizeMode(v as ResizeMode)} />
        {resizeMode === "exact" && (
          <>
            <div className="flex flex-wrap gap-4">
              {AXES.map((label, k) => (
                <Field key={label} label={`${label} mm`}>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={0.1}
                    value={size[k] || ""}
                    onChange={(e) => setAxis(k, Number(e.target.value))}
                    className={input}
                  />
                </Field>
              ))}
            </div>
            <Check checked={keepRatio} onChange={setKeepRatio} label="等比例縮放" />
          </>
        )}
        {resizeMode === "ai" && <p className="text-sm text-zinc-500">在下面的需求說明寫想要的大小，例如「底部大約 25 mm 寬，適合放在單顆軸上」。</p>}
      </Section>

      <Section title="3. 鍵盤軸回彈（十字孔）" disabled={busy || !picked}>
        <Check checked={stemOn} onChange={setStemOn} label="在模型底部做十字孔，插在鍵盤軸上按壓回彈" />
        {stemOn && (
          <>
            <Field label="做法">
              <Chips options={STEM_MODE_OPTIONS} value={stemMode} onChange={(v) => setStemMode(v as StemMode | "auto")} />
            </Field>
            <StemModeHint mode={stemMode} stem={stem} />
            {stemMode === "split" && (
              <>
                <Field
                  label="切割高度 mm（從底部往上算，留空交給 AI）"
                  hint={`至少 ${(Math.ceil(splitLayout(stem).minBase * 10) / 10).toFixed(1)} mm，底座才裝得下軸；以修改後的尺寸計算${
                    resizeMode === "ai" ? "（尺寸交給 AI，最後高度不確定）" : `，模型高 ${(resizeMode === "exact" ? size[2] : (picked?.sizeMm[2] ?? 0)).toFixed(1)} mm`
                  }。切口選在模型本來就有分界的地方（例如身體和底座的交界）會比較自然。`}
                >
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={0.5}
                    value={cutHeight}
                    placeholder="交給 AI"
                    onChange={(e) => setCutHeight(e.target.value)}
                    className={input}
                  />
                </Field>
                {picked && (
                  <CutPreview
                    meshes={picked.meshes}
                    // 預覽用的是原始模型：把修改後的切割高度換回原始尺寸；尺寸交給 AI 時不知道倍率
                    cutHeightMm={
                      cutHeight === "" || resizeMode === "ai"
                        ? undefined
                        : Number(cutHeight) / (resizeMode === "exact" ? size[2] / picked.sizeMm[2] : 1)
                    }
                    note={
                      cutHeight === ""
                        ? "填入切割高度後，這裡會用紅色標出切開的位置"
                        : resizeMode === "ai"
                          ? "尺寸交給 AI 時，最後高度不確定，無法預覽切割位置"
                          : undefined
                    }
                  />
                )}
              </>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {/* 底座方孔只有切開做法用得到 */}
              {STEM_FIELDS.filter((f) => f.key !== "plateHole" || stemMode === "split" || stemMode === "auto").map((f) => (
                <Field key={f.key} label={`${f.label} mm`} hint={f.hint}>
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={stem[f.key]}
                    onChange={(e) => setStem((s) => ({ ...s, [f.key]: Number(e.target.value) }))}
                    className={input}
                  />
                </Field>
              ))}
            </div>
            <p className="text-sm text-zinc-500">
              孔的大小 = 十字 + 2 × 間隙：{(stem.crossLength + 2 * stem.clearance).toFixed(2)} × {(stem.crossWidth + 2 * stem.clearance).toFixed(2)} mm，深{" "}
              {stem.depth} mm。
              <button type="button" onClick={() => setStem(DEFAULT_STEM)} className="ml-2 underline">
                恢復 MX 預設值
              </button>
            </p>
          </>
        )}
      </Section>

      <Section title="4. 需求說明（給 AI 看）" disabled={busy || !picked}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="例如：做成桌上的按壓紓壓公仔，底面不要超過 30 mm；十字孔放在重心下方；外觀要乾淨，看不到柱子"
          className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
        />
      </Section>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || !picked}
        className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
      >
        {phase === "uploading"
          ? "上傳中…"
          : phase === "working"
            ? `AI 規劃並修改模型中…已經過 ${elapsed} 秒（約需 1–2 分鐘）`
            : "開始修改"}
      </button>
      <p className="text-center text-xs text-zinc-500">每次修改會使用 OpenAI 點數。第一次用新的間隙，建議先印一個小的測試鬆緊。</p>
    </form>
  );
}

// 切割位置預覽：從平台前方、右側看，紅色平面是切口；輸入停下來 0.4 秒後才重畫
function CutPreview({ meshes, cutHeightMm, note }: { meshes: MeshData[]; cutHeightMm?: number; note?: string }) {
  const [shots, setShots] = useState<Snapshot[]>([]);
  const valid = cutHeightMm !== undefined && Number.isFinite(cutHeightMm) && cutHeightMm > 0;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let rendered: Snapshot[] = [];
    const timer = setTimeout(async () => {
      try {
        rendered = await renderSnapshots(meshes, SNAPSHOT_VIEWS.slice(0, 2), { cutHeightMm });
        if (cancelled) rendered.forEach((s) => URL.revokeObjectURL(s.url));
        else setShots(rendered);
      } catch (err) {
        console.error("切割位置預覽失敗", err);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      rendered.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, [meshes, cutHeightMm, valid]);

  if (!valid) return note ? <p className="text-sm text-zinc-500">{note}</p> : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        {shots.map((s) => (
          <figure key={s.id} className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url} alt={s.label} className="aspect-square w-full rounded-lg border border-zinc-300 dark:border-zinc-700" />
            <figcaption className="text-center text-xs text-zinc-500">{s.label}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-zinc-500">紅色平面是切割位置：下面是底座，上面是本體。</p>
    </div>
  );
}

function StemModeHint({ mode, stem }: { mode: StemMode | "auto"; stem: StemSpec }) {
  const split = splitLayout(stem);
  const text = {
    split: `模型底部往上切一刀：上半部（本體）底部內嵌十字孔，下半部（底座）從切口往下挖凹槽裝鍵盤軸（底面是實心的），軸從底座上方壓進 ${stem.plateHole} mm 方孔卡住。底座至少 ${split.minBase.toFixed(1)} mm 高，組裝後本體和底座之間有 ${split.gap.toFixed(1)} mm 間隙讓你按。模型底部要有約 20 mm 見方的實心區域。`,
    protrude: `柱座從模型底部往下凸出 ${stemClearanceHeight(stem).toFixed(1)} mm，任何形狀都能做，但看得到柱子。`,
    pocket: `底部挖凹槽讓軸體退進去（像鍵帽），底面要平、約 20 mm 見方。`,
    auto: "AI 看模型的形狀和大小選做法。",
  }[mode];
  return <p className="text-sm text-zinc-500">{text}</p>;
}

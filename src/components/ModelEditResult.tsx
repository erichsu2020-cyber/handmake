"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { downloadUrl } from "@/lib/blob-url";
import { readBambuProject } from "@/lib/bambu-project-read";
import { BOTTOM_VIEW, SNAPSHOT_VIEWS, renderSnapshots, type Snapshot } from "@/lib/model-snapshots";
import { STEM_FIELDS, STEM_MODES, type EditResult } from "@/lib/model-edit-settings";

const ModelPreview = dynamic(() => import("@/components/ModelPreview"), { ssr: false });

// 一筆「AI 改模型」紀錄：AI 的計畫、實際做出來的尺寸和十字孔、修改前後的截圖、3D 預覽

const mm = (v: number[]) => v.map((x) => x.toFixed(1)).join(" × ");
const RESIZE_LABELS = { keep: "不改", exact: "指定", ai: "交給 AI" } as const;

export function SnapshotGrid({ snapshots }: { snapshots: { id: string; label: string; url: string }[] }) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${snapshots.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
      {snapshots.map((s) => (
        <figure key={s.id} className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.url} alt={s.label} className="aspect-square w-full rounded-lg border border-zinc-300 dark:border-zinc-700" />
          <figcaption className="text-center text-xs text-zinc-500">{s.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function ModelEditResult({ edit }: { edit: EditResult }) {
  const { plan, stem, request } = edit;
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  // 改好的模型在瀏覽器拍成截圖（多一張從正下方看，才看得到十字孔）
  useEffect(() => {
    let cancelled = false;
    let shots: Snapshot[] = [];
    (async () => {
      const bytes = new Uint8Array(await (await fetch(edit.fileUrl)).arrayBuffer());
      shots = await renderSnapshots(readBambuProject(bytes).meshes, [...SNAPSHOT_VIEWS, BOTTOM_VIEW]);
      if (cancelled) shots.forEach((s) => URL.revokeObjectURL(s.url));
      else setSnapshots(shots);
    })().catch((err) => console.error("改好的模型截圖失敗", err));
    return () => {
      cancelled = true;
      shots.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, [edit.fileUrl]);

  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{title}</h3>
        <ul className="list-disc pl-5 text-sm">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">修改結果</h2>
          <a href={downloadUrl(edit.fileUrl)} className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
            下載 3MF
          </a>
        </div>
        <p>{plan.summary}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">尺寸</dt>
          <dd>
            {mm(edit.beforeMm)} → <span className="font-medium">{mm(edit.afterMm)} mm</span>
            <span className="text-zinc-500">（{plan.sizeReason}）</span>
          </dd>
          {stem && (
            <>
              <dt className="text-zinc-500">十字孔</dt>
              <dd>
                {STEM_MODES[stem.mode]}
                {stem.cutHeightMm !== undefined && `・從底部 ${stem.cutHeightMm.toFixed(1)} mm 切開・本體和底座間隙 ${stem.gapMm?.toFixed(1)} mm`}
                ・孔 {stem.holeMm.map((v) => v.toFixed(2)).join(" × ")} mm・柱座長 {stem.bossLengthMm.toFixed(1)} mm・位置偏移{" "}
                {stem.centerMm.map((v) => v.toFixed(1)).join(", ")} mm
                <span className="text-zinc-500">（{plan.stem.reason}）</span>
              </dd>
            </>
          )}
        </dl>
        {list("程式調整", edit.notes)}
        {list("注意事項", plan.warnings)}
        {list("列印建議", plan.printAdvice)}
        {snapshots.length > 0 ? <SnapshotGrid snapshots={snapshots} /> : <p className="text-sm text-zinc-500">產生截圖中…</p>}
        <ModelPreview url={edit.fileUrl} format="3MF" />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
        <h2 className="font-medium">當時的設定</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">尺寸</dt>
          <dd>
            {RESIZE_LABELS[request.resize.mode]}
            {request.resize.sizeMm && `：${mm(request.resize.sizeMm)} mm`}
          </dd>
          <dt className="text-zinc-500">十字孔</dt>
          <dd>
            {request.stem
              ? [
                  // 早期紀錄沒有做法和底座方孔
                  request.stemMode && (request.stemMode === "auto" ? "做法交給 AI" : STEM_MODES[request.stemMode]),
                  ...STEM_FIELDS.filter((f) => request.stem![f.key] !== undefined).map((f) => `${f.label} ${request.stem![f.key]}`),
                ]
                  .filter(Boolean)
                  .join("・")
              : "不加"}
          </dd>
          <dt className="text-zinc-500">需求說明</dt>
          <dd className="whitespace-pre-wrap">{request.notes || "（沒有）"}</dd>
          <dt className="text-zinc-500">AI 模型</dt>
          <dd>{edit.aiModel}</dd>
        </dl>
        {edit.snapshotUrls.length > 0 && (
          <>
            <h3 className="text-sm text-zinc-500">修改前</h3>
            <SnapshotGrid snapshots={edit.snapshotUrls.map((url, i) => ({ id: String(i), label: SNAPSHOT_VIEWS[i]?.label ?? "", url }))} />
          </>
        )}
      </section>
    </div>
  );
}

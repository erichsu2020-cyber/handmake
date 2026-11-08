import "server-only";
import { put } from "@vercel/blob";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { analyzeGeometry, bedSize, readBambuProject, type BambuProject } from "@/lib/bambu-project";
import { UserError } from "@/lib/bambu-source";
import { boundsSize, meshBounds, writeModel, type MeshData } from "@/lib/mesh";
import { NotManifoldError } from "@/lib/mesh-ops";
import { planModelEdit } from "@/lib/model-edit-ai";
import { applyModelEdit } from "@/lib/model-edit-geometry";
import {
  MAX_MODEL_EDIT_UPLOAD_BYTES,
  MODEL_EDIT_OUTPUT_FOLDER,
  type EditRequest,
  type EditResult,
} from "@/lib/model-edit-settings";

// 「AI 改模型」：下載 3MF → AI 決定參數 → 程式縮放、挖十字孔 → 存成新的 3MF
// 測試階段先不存紀錄，結果直接回給頁面

export async function runModelEdit(fileUrl: string, name: string, request: EditRequest, snapshotUrls: string[]): Promise<EditResult> {
  const res = await fetch(fileUrl, { cache: "no-store" });
  if (!res.ok) throw new UserError(`讀取 3MF 失敗 (${res.status})`, 502);
  const input = new Uint8Array(await res.arrayBuffer());
  if (input.length > MAX_MODEL_EDIT_UPLOAD_BYTES) throw new UserError("檔案不能超過 50MB", 400);

  let project: BambuProject;
  try {
    project = readBambuProject(input);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : "讀取 3MF 失敗", 400);
  }
  const geometry = analyzeGeometry(project);
  const beforeMm = boundsSize(meshBounds(project.meshes));
  const fixedSizeMm = request.resize.mode === "exact" ? request.resize.sizeMm! : request.resize.mode === "keep" ? beforeMm : undefined;

  const plan = await planModelEdit({ request, geometry, fixedSizeMm, images: snapshotUrls });

  const notes: string[] = [];
  let target = fixedSizeMm;
  if (!target) {
    const t = plan.targetSizeMm;
    target = [t.width, t.depth, t.height];
    if (!target.every((v) => Number.isFinite(v) && v >= 1 && v <= 500)) {
      notes.push("AI 給的尺寸不合理，維持原本大小");
      target = beforeMm;
    }
  }
  const changed = target.some((v, k) => Math.abs(v - beforeMm[k]) > 0.01);

  let edited;
  try {
    edited = await applyModelEdit(project.meshes, {
      targetSizeMm: changed ? target : undefined,
      stem: request.stem ? { spec: request.stem, mode: plan.stem.mode, offsetMm: [plan.stem.offsetXMm, plan.stem.offsetYMm] } : undefined,
    });
  } catch (error) {
    if (error instanceof NotManifoldError) {
      throw new UserError("這個模型不是封閉網格，無法挖十字孔。請先用 Bambu Studio 的「修復模型」再試，或只改尺寸", 400);
    }
    if (error instanceof Error) throw new UserError(error.message, 400);
    throw error;
  }
  notes.push(...edited.notes);

  const bed = bedSize(project.config);
  if (bed && edited.sizeMm.some((v, k) => v > bed[k])) {
    notes.push(`修改後 ${edited.sizeMm.map((v) => v.toFixed(0)).join("×")} mm 超過印表機平台 ${bed.join("×")} mm`);
  }

  const buffer = write3mf(edited.meshes, project.config, bed);
  const fileName = `${name.replace(/\.3mf$/i, "").slice(0, 80) || "model"}-edited.3mf`;
  const blob = await put(`${MODEL_EDIT_OUTPUT_FOLDER}${fileName}`, buffer, {
    access: "public",
    contentType: "model/3mf",
    addRandomSuffix: true,
  });

  return {
    plan,
    beforeMm,
    afterMm: edited.sizeMm,
    stem: edited.stem,
    notes,
    fileUrl: blob.url,
    fileName,
  };
}

// 原本是 Bambu Studio 專案的話，保留它的列印設定（作法同 bambu-3mf.ts）並把模型放到平台中央
function write3mf(meshes: MeshData[], config: BambuProject["config"], bed: [number, number, number] | undefined): Buffer {
  const plain = writeModel("3MF", meshes);
  if (!config) return plain;

  const files = unzipSync(new Uint8Array(plain));
  const modelPath = "3D/3dmodel.model";
  const bounds = meshBounds(meshes);
  const [bedX, bedY] = bed ?? [256, 256];
  const num = (v: number) => Number(v.toFixed(4));
  const tx = num(bedX / 2 - (bounds.min[0] + bounds.max[0]) / 2);
  const ty = num(bedY / 2 - (bounds.min[1] + bounds.max[1]) / 2);
  const tz = num(-bounds.min[2]);
  const version = String(config.version ?? "02.00.00.00");
  const model = strFromU8(files[modelPath])
    .replace(
      /<model\b([^>]*)>/,
      (_, attrs: string) =>
        `<model${attrs} xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">` +
        `\n<metadata name="Application">BambuStudio-${version}</metadata>` +
        `\n<metadata name="BambuStudio:3mfVersion">1</metadata>`,
    )
    .replace(/<item objectid="(\d+)"\s*\/>/g, (_, id: string) => `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}" printable="1"/>`);

  return Buffer.from(
    zipSync({
      ...files,
      [modelPath]: strToU8(model),
      "Metadata/project_settings.config": strToU8(JSON.stringify(config, null, 4)),
    }),
  );
}

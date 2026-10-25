import { boundsSize, meshBounds, meshStats, parseModel, scaleMeshes, writeModel } from "@/lib/mesh";
import { applyMeshOps } from "@/lib/mesh-ops";
import type { MeshStats } from "@/lib/print-estimate";
import type { ModelFormat, ProcessOptions } from "@/lib/print-settings";

// 本機處理 Tripo 轉出來的檔案：縮放尺寸 → 切底部 → 空心化 → 切開 → 輸出
// 這一步不呼叫 Tripo，所以改尺寸、切開、空心化都不扣點數

export type ModelFileInfo = {
  triangles: number;
  // 模型本身（切開前）的寬 × 深 × 高（mm）
  dimensionsMm: [number, number, number];
  pieces: number;
  stats: MeshStats;
};

export function computeScale(size: [number, number, number], o: ProcessOptions): [number, number, number] {
  const [w, d, h] = size;
  switch (o.sizeMode) {
    case "axis": {
      const extent = { width: w, depth: d, height: h }[o.sizeAxis];
      const s = o.sizeMm / extent;
      return [s, s, s];
    }
    case "fit": {
      // 等比例縮到剛好放得進列印平台
      const s = Math.min(o.bedX / w, o.bedY / d, o.bedZ / h);
      return [s, s, s];
    }
    case "xyz":
      return [o.sizeX / w, o.sizeY / d, o.sizeZ / h];
  }
}

export async function processModelFile(
  format: ModelFormat,
  input: Buffer,
  options: ProcessOptions,
): Promise<{ buffer: Buffer; info: ModelFileInfo }> {
  let meshes = parseModel(format, input);

  const size = boundsSize(meshBounds(meshes));
  if (size.some((v) => !(v > 0))) throw new Error("模型尺寸為 0，無法縮放");
  meshes = scaleMeshes(meshes, computeScale(size, options));
  const modelSize = boundsSize(meshBounds(meshes));

  // 懸空（支撐）用處理前的外型計算：空心化後內部空腔的天花板不需要外部支撐
  const outer = meshStats(meshes);

  const needsOps = options.trimBottomMm > 0 || options.hollowWallMm > 0 || options.cutAtPercent > 0;
  if (needsOps) meshes = await applyMeshOps(meshes, options);

  const { triangles, ...final } = needsOps ? meshStats(meshes) : outer;
  const stats: MeshStats = {
    volumeMm3: final.volumeMm3,
    surfaceAreaMm2: final.surfaceAreaMm2,
    overhangAreaMm2: outer.overhangAreaMm2,
    overhangVolumeMm3: outer.overhangVolumeMm3,
  };
  const round = (v: number) => Math.round(v * 10) / 10;

  return {
    buffer: writeModel(format, meshes),
    info: {
      triangles,
      dimensionsMm: [
        round(modelSize[0]),
        round(modelSize[1]),
        round(modelSize[2] - options.trimBottomMm),
      ],
      pieces: meshes.length,
      stats,
    },
  };
}

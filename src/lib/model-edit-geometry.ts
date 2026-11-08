import type { MeshData } from "@/lib/mesh";
import { boundsSize, meshBounds, scaleMeshes } from "@/lib/mesh";
import { fromManifold, loadWasm, toManifold } from "@/lib/mesh-ops";
import { POCKET_MM, POCKET_WALL_MM, STEM_MODES, stemClearanceHeight, type StemMode, type StemSpec } from "@/lib/model-edit-settings";

// 「AI 改模型」的幾何運算：AI 只決定參數，實際縮放和挖十字孔都在這裡精準計算
// 座標：Z 軸朝上、單位 mm；縮放後模型底部中心在原點

const SEGMENTS = 48;

export type GeometryInput = {
  targetSizeMm?: [number, number, number];
  stem?: { spec: StemSpec; mode: StemMode; offsetMm: [number, number] };
};

export type GeometryOutput = {
  meshes: MeshData[];
  sizeMm: [number, number, number];
  stem?: { mode: StemMode; centerMm: [number, number]; bossLengthMm: number; holeMm: [number, number, number] };
  notes: string[];
};

export async function applyModelEdit(source: MeshData[], input: GeometryInput): Promise<GeometryOutput> {
  const size = boundsSize(meshBounds(source));
  const scale = input.targetSizeMm
    ? (input.targetSizeMm.map((v, k) => v / size[k]) as [number, number, number])
    : ([1, 1, 1] as [number, number, number]);
  const meshes = scaleMeshes(source, scale);
  if (!input.stem) return { meshes, sizeMm: boundsSize(meshBounds(meshes)), notes: [] };

  const notes: string[] = [];
  const { spec } = input.stem;
  const wasm = await loadWasm();
  let solid = toManifold(wasm, meshes);
  const parts = solid.decompose().length;
  const box = solid.boundingBox();
  const radius = spec.bossDiameter / 2;

  // 柱座中心不能超出模型範圍
  const clamp = (v: number, k: 0 | 1, margin: number) => Math.min(box.max[k] - margin, Math.max(box.min[k] + margin, v));
  const center: [number, number] = [clamp(input.stem.offsetMm[0], 0, radius), clamp(input.stem.offsetMm[1], 1, radius)];
  if (center[0] !== input.stem.offsetMm[0] || center[1] !== input.stem.offsetMm[1]) {
    notes.push("AI 指定的十字孔位置太靠邊，已移到模型範圍內");
  }

  let mode = input.stem.mode;
  const clearance = stemClearanceHeight(spec);
  if (mode === "pocket") {
    const problem = pocketProblem(meshes, center, clearance, box.max[2]);
    if (problem) {
      notes.push(`無法做${STEM_MODES.pocket}（${problem}），改用${STEM_MODES.protrude}`);
      mode = "protrude";
    }
  }

  // 柱座要伸進模型裡 1 mm 才連得起來；模型底部不平（例如兩隻腳中間）時柱座會一路長到碰到模型
  const bottom = bottomUnder(meshes, center, radius * 0.9);
  if (bottom === null) throw new Error("十字孔位置的正上方沒有模型，請換個位置或在需求說明裡指定");

  const hole: [number, number, number] = [spec.crossLength + 2 * spec.clearance, spec.crossWidth + 2 * spec.clearance, spec.depth];
  let holeBottom: number;
  let bossLength: number;
  if (mode === "protrude") {
    // 柱座從模型底部往下凸出 clearance，按到底時模型才不會撞到軸體
    bossLength = bottom + 1 + clearance;
    solid = solid.add(wasm.Manifold.cylinder(bossLength, radius, radius, SEGMENTS).translate([center[0], center[1], -clearance]));
    holeBottom = -clearance;
  } else {
    // 底部挖凹槽讓軸體上蓋退進去，柱座從凹槽頂往下長到模型底面
    solid = solid.subtract(wasm.Manifold.cube([POCKET_MM, POCKET_MM, clearance + 0.01]).translate([center[0] - POCKET_MM / 2, center[1] - POCKET_MM / 2, -0.01]));
    bossLength = clearance;
    solid = solid.add(wasm.Manifold.cylinder(clearance + 1, radius, radius, SEGMENTS).translate([center[0], center[1], 0]));
    holeBottom = 0;
  }

  const arm = (x: number, y: number) =>
    wasm.Manifold.cube([x, y, spec.depth + 0.01]).translate([center[0] - x / 2, center[1] - y / 2, holeBottom - 0.01]);
  solid = solid.subtract(arm(hole[0], hole[1])).subtract(arm(hole[1], hole[0]));

  if (solid.decompose().length > parts) {
    throw new Error("十字孔的柱座沒有連到模型（可能是模型底部太薄或是空心的），請換個位置再試");
  }

  // 柱座凸出時模型被墊高，整體移回平台上
  const minZ = solid.boundingBox().min[2];
  if (minZ !== 0) solid = solid.translate([0, 0, -minZ]);
  const out = [fromManifold(solid)];
  return {
    meshes: out,
    sizeMm: boundsSize(meshBounds(out)),
    stem: { mode, centerMm: center, bossLengthMm: bossLength, holeMm: hole },
    notes,
  };
}

// 從正下方往上看，(x, y) 這條垂直線最先碰到模型的高度；沒碰到回傳 null
function lowestHit(meshes: MeshData[], x: number, y: number): number | null {
  let lowest: number | null = null;
  for (const { positions: p, indices } of meshes) {
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || y < Math.min(ay, by, cy) || y > Math.max(ay, by, cy)) continue;
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denom) < 1e-12) continue;
      const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
      const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
      const w3 = 1 - w1 - w2;
      if (w1 < 0 || w2 < 0 || w3 < 0) continue;
      const z = w1 * p[a + 2] + w2 * p[b + 2] + w3 * p[c + 2];
      if (lowest === null || z < lowest) lowest = z;
    }
  }
  return lowest;
}

// 柱座範圍內（中心＋一圈 8 點）模型底面最高的地方：柱座要長到這裡才能整圈都連到模型
function bottomUnder(meshes: MeshData[], [cx, cy]: [number, number], r: number): number | null {
  const centerHit = lowestHit(meshes, cx, cy);
  if (centerHit === null) return null;
  let highest = centerHit;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const z = lowestHit(meshes, cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    if (z !== null && z > highest) highest = z;
  }
  return Math.max(0, highest);
}

// 凹槽需要：凹槽加一圈牆的範圍都是平的底面，而且模型夠高、凹槽上面還有頂
function pocketProblem(meshes: MeshData[], [cx, cy]: [number, number], depth: number, height: number): string | null {
  const half = POCKET_MM / 2 + POCKET_WALL_MM;
  if (height < depth + 1.5) return "模型不夠高";
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const z = lowestHit(meshes, cx - half + (2 * half * i) / steps, cy - half + (2 * half * j) / steps);
      if (z === null) return `底面要有完整的 ${Math.ceil(half * 2)} mm 見方（模型太小或底部有洞）`;
      if (z > 0.3) return "底部不是平的";
    }
  }
  return null;
}

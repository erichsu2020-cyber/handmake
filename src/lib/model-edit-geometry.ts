import type { MeshData } from "@/lib/mesh";
import { boundsSize, meshBounds, scaleMeshes } from "@/lib/mesh";
import { arrangeSideBySide, fromManifold, loadWasm, toManifold, type Manifold, type Wasm } from "@/lib/mesh-ops";
import {
  MX_PLATE,
  POCKET_MM,
  POCKET_WALL_MM,
  SPLIT_WALL_MM,
  STEM_MODES,
  splitLayout,
  stemClearanceHeight,
  type StemMode,
  type EditResult,
  type StemSpec,
} from "@/lib/model-edit-settings";

// 「AI 改模型」的幾何運算：AI 只決定參數，實際縮放和挖十字孔都在這裡精準計算
// 座標：Z 軸朝上、單位 mm；縮放後模型底部中心在原點

const SEGMENTS = 48;

export type GeometryInput = {
  targetSizeMm?: [number, number, number];
  // cutHeightMm：切開做法的切割高度。AI 建議的（cutFixed 不是 true）太低或切不出底座時程式會往上找；
  // 使用者指定的（cutFixed）只會在這個高度切，切不出來就回報原因
  stem?: { spec: StemSpec; mode: StemMode; offsetMm: [number, number]; cutHeightMm?: number; cutFixed?: boolean };
};

export type GeometryOutput = {
  meshes: MeshData[];
  // 切開做法有兩個部件，寫進 3MF 的物件名稱
  partNames?: string[];
  // 組裝後的尺寸
  sizeMm: [number, number, number];
  stem?: NonNullable<EditResult["stem"]>;
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

  const hole: [number, number, number] = [spec.crossLength + 2 * spec.clearance, spec.crossWidth + 2 * spec.clearance, spec.depth];
  if (input.stem.mode === "split") return splitWithStem(wasm, solid, spec, center, hole, input.stem.cutHeightMm, input.stem.cutFixed ?? false, notes);

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

  solid = solid.subtract(crossHole(wasm, hole, center, holeBottom));

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

// 十字孔：兩個長方體交叉，從 bottom 往上挖 hole[2] 深
function crossHole(wasm: Wasm, hole: [number, number, number], [cx, cy]: [number, number], bottom: number): Manifold {
  const arm = (x: number, y: number) => wasm.Manifold.cube([x, y, hole[2] + 0.01]).translate([cx - x / 2, cy - y / 2, bottom - 0.01]);
  return arm(hole[0], hole[1]).add(arm(hole[1], hole[0]));
}

// 置中在 (cx, cy) 的方塊，從 z 往上 height
const centeredBox = (wasm: Wasm, size: number, [cx, cy]: [number, number], z: number, height: number) =>
  wasm.Manifold.cube([size, size, height]).translate([cx - size / 2, cy - size / 2, z]);

// 切開做法：模型在 cut 高度切一刀
// - 本體（上半部）：底部挖凹槽讓按到底的軸體上蓋伸進來，凹槽中間的柱座跟底面齊平，柱座裡是十字孔
// - 底座（下半部）：上方凹槽讓軸體上蓋陷進去，接著是 1.5 mm 厚、開方孔的卡板（軸的卡扣扣在這裡），
//   下方挖空放軸的下蓋和針腳；凹槽只挖需要的深度，以下都是實心的
// 高度怎麼算見 splitLayout；兩個部件並排放在平台上，各自正著印
function splitWithStem(
  wasm: Wasm,
  solid: Manifold,
  spec: StemSpec,
  wanted: [number, number],
  hole: [number, number, number],
  cutAsked: number | undefined,
  cutFixed: boolean,
  notes: string[],
): GeometryOutput {
  const layout = splitLayout(spec);
  const box = solid.boundingBox();
  const height = box.max[2] - box.min[2];
  const square = Math.ceil(POCKET_MM + SPLIT_WALL_MM * 2);

  if (cutFixed && cutAsked !== undefined) {
    const maxCut = height - layout.pocket - 1.5;
    if (cutAsked > maxCut) {
      throw new Error(`切割高度 ${cutAsked} mm 太高：本體至少要留 ${(layout.pocket + 1.5).toFixed(1)} mm 做十字孔，最高只能切在 ${maxCut.toFixed(1)} mm`);
    }
    if (!findCut(wasm, solid, layout, wanted, cutAsked, true)) {
      const other = findCut(wasm, solid, layout, wanted, undefined);
      throw new Error(
        `在 ${cutAsked} mm 切開時，切口上下的截面不夠 ${square} mm 見方的實心區域，底座或本體裝不下軸。` +
          (other ? `可以改切在 ${other.cut} mm，或留空讓 AI 決定` : "這個大小的模型切不出底座，請把模型放大或改用其他做法"),
      );
    }
  }

  const found = findCut(wasm, solid, layout, wanted, cutAsked, cutFixed);
  if (!found) {
    // 切不出來：試著放大，告訴使用者大概要多大
    let advice = "請把模型放大或改用其他做法";
    for (let scale = 1.1; scale <= 3; scale += 0.1) {
      if (findCut(wasm, solid.scale(scale), layout, [wanted[0] * scale, wanted[1] * scale], undefined)) {
        advice = `把模型等比放大到約 ${Math.ceil(height * scale)} mm 高（現在 ${Math.round(height)} mm）就能切開，或改用其他做法`;
        break;
      }
    }
    throw new Error(`模型底部不夠大：切開做法需要從底部往上一段都有 ${square} mm 見方的實心區域。${advice}`);
  }
  const { cut, center } = found;
  if (center[0] !== wanted[0] || center[1] !== wanted[1]) {
    notes.push(`原本的十字孔位置切不出底座，往旁邊移到 ${center.map((v) => v.toFixed(1)).join(", ")} mm`);
  }
  if (cutAsked !== undefined && Math.abs(cut - cutAsked) > 0.01) {
    notes.push(
      cutAsked < layout.minBase
        ? `底座至少要 ${layout.minBase.toFixed(1)} mm 高才裝得下軸，切割高度從 ${cutAsked.toFixed(1)} 改成 ${cut.toFixed(1)} mm`
        : `${cutAsked.toFixed(1)} mm 高的切面不夠大，切割高度改成 ${cut.toFixed(1)} mm`,
    );
  }

  const [top, bottom] = solid.splitByPlane([0, 0, 1], cut);
  let body = top.translate([0, 0, -cut]);
  const parts = body.decompose().length;
  const radius = spec.bossDiameter / 2;
  body = body
    .subtract(centeredBox(wasm, POCKET_MM, center, -0.01, layout.pocket + 0.01))
    .add(wasm.Manifold.cylinder(layout.pocket + 1, radius, radius, SEGMENTS).translate([center[0], center[1], 0]))
    .subtract(crossHole(wasm, hole, center, 0));
  if (body.decompose().length > parts) throw new Error("十字孔的柱座沒有連到本體，請換個位置再試");

  const plateBottom = cut - layout.recess - MX_PLATE;
  const cavityBottom = cut - layout.cavity;
  let base = bottom
    .subtract(centeredBox(wasm, spec.plateHole, center, cavityBottom, layout.cavity + 0.01))
    .subtract(centeredBox(wasm, POCKET_MM, center, cavityBottom, plateBottom - cavityBottom + 0.01));
  if (layout.recess > 0) base = base.subtract(centeredBox(wasm, POCKET_MM, center, cut - layout.recess, layout.recess + 0.01));

  const meshes = arrangeSideBySide([base, body]).map(fromManifold);
  return {
    meshes,
    partNames: ["底座（裝鍵盤軸）", "本體（內嵌十字孔）"],
    sizeMm: [box.max[0] - box.min[0], box.max[1] - box.min[1], height + layout.gap],
    stem: { mode: "split", centerMm: center, bossLengthMm: layout.pocket, holeMm: hole, cutHeightMm: cut, gapMm: layout.gap },
    notes,
  };
}

// 找切割高度和十字孔位置：底座的凹槽範圍（切口往下 cavity）和本體的凹槽到凹槽頂上方，
// 每一層截面都要整片蓋住「凹槽加一圈牆」的方形。位置先用 wanted，不行再往旁邊最多 4 mm 找
// 每個高度只切一次截面（最花時間的部分），再跟各個候選位置的方形比對
function findCut(
  wasm: Wasm,
  solid: Manifold,
  layout: ReturnType<typeof splitLayout>,
  wanted: [number, number],
  cutAsked: number | undefined,
  fixed = false,
): { cut: number; center: [number, number] } | null {
  const STEP = 0.5;
  const height = solid.boundingBox().max[2];
  const above = layout.pocket + 1.5;
  // 自動找的話切口最高到模型高度的 70%，指定高度就照指定的
  const maxCut = fixed && cutAsked !== undefined ? cutAsked : height * 0.7;
  const levels = Math.floor(Math.min(height, maxCut + above) / STEP);
  if (levels * STEP < layout.minBase + above) return null;

  const centers: [number, number][] = [];
  for (const dx of [0, -2, 2, -4, 4]) for (const dy of [0, -2, 2, -4, 4]) centers.push([wanted[0] + dx, wanted[1] + dy]);
  centers.sort((p, q) => Math.hypot(p[0] - wanted[0], p[1] - wanted[1]) - Math.hypot(q[0] - wanted[0], q[1] - wanted[1]));

  const half = POCKET_MM / 2 + SPLIT_WALL_MM;
  const squares = centers.map(([cx, cy]) => wasm.CrossSection.square([half * 2, half * 2]).translate([cx - half, cy - half]));
  const full = half * half * 4 * 0.99;
  // covered[i][k]：第 k 層（高度 (k + 1) × STEP）蓋住第 i 個位置的方形
  const covered = centers.map(() => new Array<boolean>(levels).fill(false));
  for (let k = 0; k < levels; k++) {
    const section = solid.slice((k + 1) * STEP);
    squares.forEach((sq, i) => (covered[i][k] = section.intersect(sq).area() >= full));
  }

  const start = Math.max(layout.minBase, cutAsked ?? 0);
  const cuts: number[] = [];
  if (fixed && cutAsked !== undefined) cuts.push(cutAsked);
  else for (let cut = Math.ceil(start / STEP) * STEP; cut <= maxCut; cut += STEP) cuts.push(cut);
  for (let i = 0; i < centers.length; i++) {
    for (const cut of cuts) {
      const top = cut + above;
      let ok = top <= height;
      // 凹槽以下是實心的，不用檢查；切口那一層本身不檢查
      for (let z = Math.ceil((cut - layout.cavity) / STEP) * STEP + STEP; ok && z <= top + 1e-6; z += STEP) {
        if (Math.abs(z - cut) < STEP / 2) continue;
        ok = covered[i][Math.round(z / STEP) - 1] ?? false;
      }
      if (ok) return { cut, center: centers[i] };
    }
  }
  return null;
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

import Module from "manifold-3d";
import type { MeshData } from "@/lib/mesh";

// 切開、空心化需要「封閉網格」的布林運算，用 manifold-3d（WASM）處理
type Wasm = Awaited<ReturnType<typeof Module>>;
type Manifold = InstanceType<Wasm["Manifold"]>;

let wasmPromise: Promise<Wasm> | null = null;
function loadWasm() {
  wasmPromise ??= Module().then((wasm) => {
    wasm.setup();
    return wasm;
  });
  return wasmPromise;
}

export class NotManifoldError extends Error {
  constructor() {
    super("這個模型不是封閉網格（常見於拆零件或 P1 版本），無法切開或空心化");
  }
}

export type MeshOps = {
  trimBottomMm: number;
  hollowWallMm: number;
  drainHole: boolean;
  cutAtPercent: number;
};

const GAP_MM = 5; // 切開後兩塊之間的距離

export async function applyMeshOps(meshes: MeshData[], ops: MeshOps): Promise<MeshData[]> {
  const wasm = await loadWasm();
  let solid = toManifold(wasm, meshes);

  if (ops.trimBottomMm > 0) {
    const bottom = solid.boundingBox().min[2];
    solid = solid.trimByPlane([0, 0, 1], bottom + ops.trimBottomMm).translate([0, 0, -ops.trimBottomMm]);
    if (solid.isEmpty()) throw new Error("底部切除太多，模型被切光了");
  }

  if (ops.hollowWallMm > 0) {
    solid = hollow(wasm, solid, ops.hollowWallMm, ops.drainHole);
  }

  let pieces = [solid];
  if (ops.cutAtPercent > 0) {
    const box = solid.boundingBox();
    const cutZ = box.min[2] + (box.max[2] - box.min[2]) * (ops.cutAtPercent / 100);
    const [top, bottom] = solid.splitByPlane([0, 0, 1], cutZ);
    if (top.isEmpty() || bottom.isEmpty()) throw new Error("切開位置沒有切到模型");
    pieces = arrangeSideBySide([bottom, flipUpsideDown(top)]);
  }

  return pieces.map((piece) => fromManifold(piece));
}

function toManifold(wasm: Wasm, meshes: MeshData[]): Manifold {
  const vertCount = meshes.reduce((sum, m) => sum + m.positions.length, 0);
  const triCount = meshes.reduce((sum, m) => sum + m.indices.length, 0);
  const vertProperties = new Float32Array(vertCount);
  const triVerts = new Uint32Array(triCount);

  let vOffset = 0;
  let tOffset = 0;
  for (const m of meshes) {
    vertProperties.set(m.positions, vOffset);
    for (let i = 0; i < m.indices.length; i++) triVerts[tOffset + i] = m.indices[i] + vOffset / 3;
    vOffset += m.positions.length;
    tOffset += m.indices.length;
  }

  const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
  mesh.merge(); // 合併重複頂點（STL 每個三角形各自存頂點）
  try {
    return wasm.Manifold.ofMesh(mesh);
  } catch {
    throw new NotManifoldError();
  }
}

function fromManifold(solid: Manifold): MeshData {
  const mesh = solid.getMesh();
  const positions = new Float32Array(mesh.numVert * 3);
  for (let v = 0; v < mesh.numVert; v++) {
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = mesh.vertProperties[v * mesh.numProp + k];
  }
  return { positions, indices: Uint32Array.from(mesh.triVerts) };
}

// 上半部翻過來，讓切面朝下貼著平台
function flipUpsideDown(solid: Manifold): Manifold {
  const flipped = solid.rotate([180, 0, 0]);
  return flipped.translate([0, 0, -flipped.boundingBox().min[2]]);
}

function arrangeSideBySide(pieces: Manifold[]): Manifold[] {
  const widths = pieces.map((p) => p.boundingBox().max[0] - p.boundingBox().min[0]);
  const total = widths.reduce((a, b) => a + b, 0) + GAP_MM * (pieces.length - 1);
  let x = -total / 2;
  return pieces.map((piece, i) => {
    const box = piece.boundingBox();
    const placed = piece.translate([
      x - box.min[0],
      -(box.min[1] + box.max[1]) / 2,
      -box.min[2],
    ]);
    x += widths[i] + GAP_MM;
    return placed;
  });
}

// ---------- 空心化 ----------
// 1. 把模型轉成體素（判斷每個小方塊在不在模型裡面）
// 2. 算每個內部體素到表面的距離
// 3. 距離 > 壁厚的區域就是要挖掉的內部空間，用 levelSet 轉回網格後挖掉

function hollow(wasm: Wasm, solid: Manifold, wallMm: number, drainHole: boolean): Manifold {
  const box = solid.boundingBox();
  const size = [0, 1, 2].map((k) => box.max[k] - box.min[k]);
  const maxDim = Math.max(...size);
  // 體素越小越準，但越慢；壁厚至少要有 3 格
  const h = Math.max(maxDim / 220, Math.min(wallMm / 3, maxDim / 120));
  const pad = 2;
  const n = size.map((s) => Math.ceil(s / h) + pad * 2);
  const origin = [0, 1, 2].map((k) => box.min[k] - pad * h);
  const [nx, ny, nz] = n;
  const index = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const inside = voxelize(solid.getMesh(), n, origin, h);
  const distance = distanceToOutside(inside, n, h);

  const sample = (x: number, y: number, z: number) => {
    // 三線性內插
    const fx = (x - origin[0]) / h - 0.5, fy = (y - origin[1]) / h - 0.5, fz = (z - origin[2]) / h - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return 0;
    const tx = fx - i, ty = fy - j, tz = fz - k;
    let value = 0;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
          value += w * distance[index(i + dx, j + dy, k + dz)];
        }
    return value;
  };

  const innerBox = {
    min: [box.min[0] + wallMm, box.min[1] + wallMm, box.min[2] + wallMm] as [number, number, number],
    max: [box.max[0] - wallMm, box.max[1] - wallMm, box.max[2] - wallMm] as [number, number, number],
  };
  if (innerBox.min.some((v, k) => v >= innerBox.max[k])) {
    throw new Error("壁厚太厚，模型裡面沒有空間可以挖空");
  }

  const cavity = wasm.Manifold.levelSet(
    ([x, y, z]) => sample(x, y, z) - wallMm,
    innerBox,
    h,
  );
  if (cavity.isEmpty()) throw new Error("壁厚太厚，模型裡面沒有空間可以挖空");

  let result = solid.subtract(cavity);

  if (drainHole) {
    // 在底部中心開一個直徑 3mm 的孔，讓樹脂流出來
    const cx = (box.min[0] + box.max[0]) / 2, cy = (box.min[1] + box.max[1]) / 2;
    const hole = wasm.Manifold.cylinder(wallMm + 2, 1.5, 1.5, 24).translate([cx, cy, box.min[2] - 1]);
    result = result.subtract(hole);
  }
  return result;
}

// 沿 Z 軸對每一欄射線，計算穿過網格的位置，成對區間內就是模型內部
function voxelize(
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number },
  [nx, ny, nz]: number[],
  origin: number[],
  h: number,
): Uint8Array {
  const crossings: number[][] = Array.from({ length: nx * ny }, () => []);
  const p = mesh.vertProperties, tris = mesh.triVerts, stride = mesh.numProp;

  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * stride, b = tris[t + 1] * stride, c = tris[t + 2] * stride;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-12) continue;

    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - origin[0]) / h - 0.5));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - origin[0]) / h - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - origin[1]) / h - 0.5));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - origin[1]) / h - 0.5));

    for (let i = i0; i <= i1; i++) {
      const x = origin[0] + (i + 0.5) * h;
      for (let j = j0; j <= j1; j++) {
        const y = origin[1] + (j + 0.5) * h;
        const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
        const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
        const w3 = 1 - w1 - w2;
        if (w1 < 0 || w2 < 0 || w3 < 0) continue;
        crossings[j * nx + i].push(w1 * az + w2 * bz + w3 * cz);
      }
    }
  }

  const inside = new Uint8Array(nx * ny * nz);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const zs = crossings[j * nx + i].sort((a, b) => a - b);
      for (let s = 0; s + 1 < zs.length; s += 2) {
        const k0 = Math.max(0, Math.ceil((zs[s] - origin[2]) / h - 0.5));
        const k1 = Math.min(nz - 1, Math.floor((zs[s + 1] - origin[2]) / h - 0.5));
        for (let k = k0; k <= k1; k++) inside[(k * ny + j) * nx + i] = 1;
      }
    }
  }
  return inside;
}

// 歐氏距離轉換（Felzenszwalb & Huttenlocher），回傳每個內部體素到最近外部體素的距離（mm）
function distanceToOutside(inside: Uint8Array, [nx, ny, nz]: number[], h: number): Float32Array {
  const INF = 1e20;
  const d = new Float64Array(inside.length);
  for (let i = 0; i < inside.length; i++) d[i] = inside[i] ? INF : 0;

  const maxN = Math.max(nx, ny, nz);
  const f = new Float64Array(maxN), out = new Float64Array(maxN);
  const v = new Int32Array(maxN), z = new Float64Array(maxN + 1);

  const edt1d = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  const pass = (len: number, count: number, at: (line: number, q: number) => number) => {
    for (let line = 0; line < count; line++) {
      for (let q = 0; q < len; q++) f[q] = d[at(line, q)];
      edt1d(len);
      for (let q = 0; q < len; q++) d[at(line, q)] = out[q];
    }
  };

  pass(nx, ny * nz, (line, q) => line * nx + q);
  pass(ny, nx * nz, (line, q) => {
    const k = Math.floor(line / nx), i = line % nx;
    return (k * ny + q) * nx + i;
  });
  pass(nz, nx * ny, (line, q) => q * nx * ny + line);

  const result = new Float32Array(inside.length);
  for (let i = 0; i < d.length; i++) result[i] = Math.sqrt(d[i]) * h;
  return result;
}

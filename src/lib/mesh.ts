import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ModelFormat } from "@/lib/print-settings";
import type { MeshStats } from "@/lib/print-estimate";

// 統一的網格格式：Z 軸朝上、單位 mm
// 實測 Tripo 輸出：STL／3MF 是 Z 軸朝上；OBJ 是 Y 軸朝上、包在 zip 裡、頂點帶顏色
export type MeshData = {
  positions: Float32Array; // x,y,z 連續排列
  indices: Uint32Array; // 每 3 個一個三角形
  colors?: Float32Array; // r,g,b（0–1），只有彩色 OBJ 有
};

export type Bounds = { min: [number, number, number]; max: [number, number, number] };

// ---------- 讀檔 ----------

export function parseModel(format: ModelFormat, input: Buffer): MeshData[] {
  switch (format) {
    case "STL":
      return [parseStl(input)];
    case "3MF":
      return parse3mf(input);
    case "OBJ":
      return [parseObj(input)];
  }
}

function parseStl(input: Buffer): MeshData {
  const triangles = input.length >= 84 ? input.readUInt32LE(80) : 0;
  if (input.length !== 84 + triangles * 50) {
    // 不是二進位 STL 的話，試試文字（ASCII）格式：很多軟體匯出的是這種
    if (input.subarray(0, 5).toString("latin1").toLowerCase() === "solid") return parseAsciiStl(input);
    throw new Error("STL 格式不正確");
  }

  const positions = new Float32Array(triangles * 9);
  for (let i = 0; i < triangles; i++) {
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = input.readFloatLE(84 + i * 50 + 12 + k * 4);
  }
  return { positions, indices: Uint32Array.from({ length: triangles * 3 }, (_, i) => i) };
}

// 每個 facet 有三行「vertex x y z」
function parseAsciiStl(input: Buffer): MeshData {
  const values: number[] = [];
  for (const [, x, y, z] of input.toString("latin1").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    values.push(Number(x), Number(y), Number(z));
  }
  if (values.length === 0 || values.length % 9 !== 0 || values.some((v) => !Number.isFinite(v))) {
    throw new Error("STL 格式不正確");
  }
  return { positions: Float32Array.from(values), indices: Uint32Array.from({ length: values.length / 3 }, (_, i) => i) };
}

function parse3mf(input: Buffer): MeshData[] {
  const files = unzipSync(new Uint8Array(input));
  const meshes: MeshData[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (!path.endsWith(".model")) continue;
    for (const [, body] of strFromU8(data).matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)) {
      const vertices = [...body.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)];
      const triangles = [...body.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)];
      meshes.push({
        positions: Float32Array.from(vertices.flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])])),
        indices: Uint32Array.from(triangles.flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])])),
      });
    }
  }
  if (meshes.length === 0) throw new Error("3MF 裡找不到模型資料");
  return meshes;
}

function parseObj(input: Buffer): MeshData {
  let text: string;
  if (input.subarray(0, 4).toString("hex") === "504b0304") {
    const files = unzipSync(new Uint8Array(input));
    const objPath = Object.keys(files).find((path) => path.toLowerCase().endsWith(".obj"));
    if (!objPath) throw new Error("OBJ 壓縮檔裡找不到 .obj");
    text = strFromU8(files[objPath]);
  } else {
    text = input.toString("utf8");
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/).map(Number);
      // Y 軸朝上 → Z 軸朝上
      positions.push(p[1], -p[3], p[2]);
      if (p.length >= 7) colors.push(p[4], p[5], p[6]);
    } else if (line.startsWith("f ")) {
      const ids = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((token) => Number(token.split("/")[0]) - 1);
      for (let i = 1; i < ids.length - 1; i++) indices.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    colors: colors.length === positions.length ? Float32Array.from(colors) : undefined,
  };
}

// ---------- 寫檔 ----------

export function writeModel(format: ModelFormat, meshes: MeshData[]): Buffer {
  switch (format) {
    case "STL":
      return writeStl(meshes);
    case "3MF":
      return write3mf(meshes);
    case "OBJ":
      return writeObj(meshes);
  }
}

function writeStl(meshes: MeshData[]) {
  const triangles = meshes.reduce((sum, m) => sum + m.indices.length / 3, 0);
  const buffer = Buffer.alloc(84 + triangles * 50);
  buffer.write("handmake", 0);
  buffer.writeUInt32LE(triangles, 80);

  let offset = 84;
  for (const { positions: p, indices } of meshes) {
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const n = faceNormal(p, a, b, c);
      [n[0], n[1], n[2]].forEach((v, k) => buffer.writeFloatLE(v, offset + k * 4));
      [a, b, c].forEach((vi, j) => {
        for (let k = 0; k < 3; k++) buffer.writeFloatLE(p[vi + k], offset + 12 + j * 12 + k * 4);
      });
      offset += 50;
    }
  }
  return buffer;
}

function write3mf(meshes: MeshData[]) {
  const num = (v: number) => Number(v.toFixed(4)).toString();
  const objects = meshes.map(({ positions: p, indices }, i) => {
    const vertices: string[] = [];
    for (let v = 0; v < p.length; v += 3) {
      vertices.push(`<vertex x="${num(p[v])}" y="${num(p[v + 1])}" z="${num(p[v + 2])}"/>`);
    }
    const triangles: string[] = [];
    for (let t = 0; t < indices.length; t += 3) {
      triangles.push(`<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>`);
    }
    return `<object id="${i + 1}" name="part_${i + 1}" type="model"><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object>`;
  });
  const items = meshes.map((_, i) => `<item objectid="${i + 1}"/>`).join("");

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>${objects.join("")}</resources>
<build>${items}</build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "3D/3dmodel.model": strToU8(model),
    }),
  );
}

function writeObj(meshes: MeshData[]) {
  const lines = ["# handmake"];
  let base = 1;
  for (const { positions: p, indices, colors } of meshes) {
    for (let v = 0; v < p.length; v += 3) {
      // Z 軸朝上 → 寫回 OBJ 慣用的 Y 軸朝上
      const xyz = [p[v], p[v + 2], -p[v + 1]].map((n) => Number(n.toFixed(4)));
      const rgb = colors ? [colors[v], colors[v + 1], colors[v + 2]].map((n) => Number(n.toFixed(4))) : [];
      lines.push(`v ${[...xyz, ...rgb].join(" ")}`);
    }
    for (let t = 0; t < indices.length; t += 3) {
      lines.push(`f ${indices[t] + base} ${indices[t + 1] + base} ${indices[t + 2] + base}`);
    }
    base += p.length / 3;
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

// ---------- 幾何計算 ----------

function faceNormal(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function meshBounds(meshes: MeshData[]): Bounds {
  const min: Bounds["min"] = [Infinity, Infinity, Infinity];
  const max: Bounds["max"] = [-Infinity, -Infinity, -Infinity];
  for (const { positions: p } of meshes) {
    for (let v = 0; v < p.length; v += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[v + k] < min[k]) min[k] = p[v + k];
        if (p[v + k] > max[k]) max[k] = p[v + k];
      }
    }
  }
  return { min, max };
}

export const boundsSize = (b: Bounds) => [0, 1, 2].map((k) => b.max[k] - b.min[k]) as [number, number, number];

// 各軸分別縮放，並把底部中心移到原點
export function scaleMeshes(meshes: MeshData[], scale: [number, number, number]): MeshData[] {
  const b = meshBounds(meshes);
  const origin = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
  return meshes.map((m) => {
    const positions = new Float32Array(m.positions.length);
    for (let v = 0; v < positions.length; v += 3) {
      for (let k = 0; k < 3; k++) positions[v + k] = (m.positions[v + k] - origin[k]) * scale[k];
    }
    return { ...m, positions };
  });
}

export function meshStats(meshes: MeshData[]): MeshStats & { triangles: number } {
  const minZ = meshBounds(meshes).min[2];
  let volume = 0, area = 0, overhangArea = 0, overhangVolume = 0, triangles = 0;
  const cos45 = Math.SQRT1_2;

  for (const { positions: p, indices } of meshes) {
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      // 有號四面體體積（封閉網格加總即為體積）
      volume +=
        (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
        6;

      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const faceArea = Math.hypot(nx, ny, nz) / 2;
      area += faceArea;
      triangles++;

      // 朝下超過 45°、而且不是貼在平台上的面 → 需要支撐
      const height = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - minZ;
      if (faceArea > 0 && nz / (2 * faceArea) < -cos45 && height > 0.5) {
        overhangArea += faceArea;
        overhangVolume += (faceArea * Math.abs(nz / (2 * faceArea))) * height;
      }
    }
  }

  return {
    volumeMm3: Math.abs(volume),
    surfaceAreaMm2: area,
    overhangAreaMm2: overhangArea,
    overhangVolumeMm3: overhangVolume,
    triangles,
  };
}

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ModelFormat } from "@/lib/print-settings";

// 把 Tripo 轉出來的檔案等比例縮放到指定高度（mm），並把底部中心移到原點
// 實測各格式的座標：STL / 3MF 是 Z 軸朝上；OBJ 是 Y 軸朝上，而且 Tripo 會包成 zip

export type ModelFileInfo = {
  triangles: number;
  // 寬 × 深 × 高（mm）
  dimensionsMm: [number, number, number];
};

type Axis = 0 | 1 | 2;
type Bounds = { min: number[]; max: number[] };

export function processModelFile(
  format: ModelFormat,
  input: Buffer,
  heightMm: number,
): { buffer: Buffer; info: ModelFileInfo } {
  switch (format) {
    case "STL":
      return processStl(input, heightMm);
    case "3MF":
      return process3mf(input, heightMm);
    case "OBJ":
      return processObj(input, heightMm);
  }
}

// ---- 共用 ----

function emptyBounds(): Bounds {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function addToBounds(bounds: Bounds, axis: number, value: number) {
  if (value < bounds.min[axis]) bounds.min[axis] = value;
  if (value > bounds.max[axis]) bounds.max[axis] = value;
}

// 回傳把座標 (axis, value) 轉成縮放後數值的函式，以及最後的尺寸
function makeTransform(bounds: Bounds, upAxis: Axis, heightMm: number) {
  const height = bounds.max[upAxis] - bounds.min[upAxis];
  if (!(height > 0)) throw new Error("模型高度為 0，無法縮放");

  const scale = heightMm / height;
  const origin = [0, 1, 2].map((axis) =>
    axis === upAxis ? bounds.min[axis] : (bounds.min[axis] + bounds.max[axis]) / 2,
  );
  const size = (axis: number) => Math.round((bounds.max[axis] - bounds.min[axis]) * scale * 10) / 10;
  const [w, d] = [0, 1, 2].filter((axis) => axis !== upAxis);

  return {
    apply: (axis: number, value: number) => (value - origin[axis]) * scale,
    dimensionsMm: [size(w), size(d), size(upAxis)] as ModelFileInfo["dimensionsMm"],
  };
}

const formatNumber = (value: number) => Number(value.toFixed(5)).toString();

// ---- STL（二進位）：80 bytes 標頭 + 4 bytes 三角形數量 + 每個三角形 50 bytes ----

function processStl(input: Buffer, heightMm: number) {
  const triangles = input.length >= 84 ? input.readUInt32LE(80) : 0;
  if (input.length !== 84 + triangles * 50) {
    throw new Error("STL 格式不正確（只支援二進位 STL）");
  }

  const buffer = Buffer.from(input);
  const vertexOffsets = function* () {
    for (let i = 0; i < triangles; i++) {
      const base = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) yield base + v * 12;
    }
  };

  const bounds = emptyBounds();
  for (const offset of vertexOffsets()) {
    for (let axis = 0; axis < 3; axis++) addToBounds(bounds, axis, buffer.readFloatLE(offset + axis * 4));
  }

  // 等比例縮放不會改變法向量方向，只需要改頂點
  const transform = makeTransform(bounds, 2, heightMm);
  for (const offset of vertexOffsets()) {
    for (let axis = 0; axis < 3; axis++) {
      const at = offset + axis * 4;
      buffer.writeFloatLE(transform.apply(axis, buffer.readFloatLE(at)), at);
    }
  }

  return { buffer, info: { triangles, dimensionsMm: transform.dimensionsMm } };
}

// ---- 3MF：zip 裡的 3D/*.model 是 XML，頂點寫成 <vertex x="" y="" z="" /> ----

const VERTEX_RE = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;

function process3mf(input: Buffer, heightMm: number) {
  const files = unzipSync(new Uint8Array(input));
  const modelPaths = Object.keys(files).filter((path) => path.endsWith(".model"));
  if (modelPaths.length === 0) throw new Error("3MF 裡找不到模型資料");

  const xmls = Object.fromEntries(modelPaths.map((path) => [path, strFromU8(files[path])]));

  const bounds = emptyBounds();
  let triangles = 0;
  for (const xml of Object.values(xmls)) {
    for (const match of xml.matchAll(VERTEX_RE)) {
      for (let axis = 0; axis < 3; axis++) addToBounds(bounds, axis, Number(match[axis + 1]));
    }
    triangles += xml.match(/<triangle\s/g)?.length ?? 0;
  }

  const transform = makeTransform(bounds, 2, heightMm);
  for (const path of modelPaths) {
    const scaled = xmls[path].replace(VERTEX_RE, (_m, x, y, z) => {
      const [sx, sy, sz] = [x, y, z].map((v, axis) => formatNumber(transform.apply(axis, Number(v))));
      return `<vertex x="${sx}" y="${sy}" z="${sz}"`;
    });
    files[path] = strToU8(scaled);
  }

  return { buffer: Buffer.from(zipSync(files)), info: { triangles, dimensionsMm: transform.dimensionsMm } };
}

// ---- OBJ：每行 "v x y z [r g b]"，顏色要原樣保留 ----

function processObj(input: Buffer, heightMm: number) {
  const isZip = input.subarray(0, 4).toString("hex") === "504b0304";
  let text: string;
  if (isZip) {
    const files = unzipSync(new Uint8Array(input));
    const objPath = Object.keys(files).find((path) => path.toLowerCase().endsWith(".obj"));
    if (!objPath) throw new Error("OBJ 壓縮檔裡找不到 .obj");
    text = strFromU8(files[objPath]);
  } else {
    text = input.toString("utf8");
  }

  const lines = text.split(/\r?\n/);
  const bounds = emptyBounds();
  let triangles = 0;
  for (const line of lines) {
    if (line.startsWith("v ")) {
      const parts = line.trim().split(/\s+/);
      for (let axis = 0; axis < 3; axis++) addToBounds(bounds, axis, Number(parts[axis + 1]));
    } else if (line.startsWith("f ")) {
      triangles += line.trim().split(/\s+/).length - 3;
    }
  }

  const transform = makeTransform(bounds, 1, heightMm);
  const scaled = lines.map((line) => {
    if (!line.startsWith("v ")) return line;
    const parts = line.trim().split(/\s+/);
    for (let axis = 0; axis < 3; axis++) {
      parts[axis + 1] = formatNumber(transform.apply(axis, Number(parts[axis + 1])));
    }
    return parts.join(" ");
  });

  return {
    buffer: Buffer.from(scaled.join("\n"), "utf8"),
    info: { triangles, dimensionsMm: transform.dimensionsMm },
  };
}

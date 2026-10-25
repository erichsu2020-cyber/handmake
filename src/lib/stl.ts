// 二進位 STL：80 bytes 標頭 + 4 bytes 三角形數量 + 每個三角形 50 bytes
// （法向量 12 + 三個頂點各 12 + 屬性 2）
const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;

export type StlInfo = {
  triangles: number;
  dimensionsMm: [number, number, number];
};

// 把模型等比例縮放到指定高度（Z 軸，單位 mm），並移到底部中心 = 原點
export function scaleStlToHeight(input: Buffer, heightMm: number): { buffer: Buffer; info: StlInfo } {
  const triangles = input.length >= HEADER_BYTES ? input.readUInt32LE(80) : 0;
  if (input.length !== HEADER_BYTES + triangles * TRIANGLE_BYTES) {
    throw new Error("STL 格式不正確（只支援二進位 STL）");
  }

  const buffer = Buffer.from(input);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  forEachVertexOffset(triangles, (offset) => {
    for (let axis = 0; axis < 3; axis++) {
      const value = buffer.readFloatLE(offset + axis * 4);
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  });

  const height = max[2] - min[2];
  if (!(height > 0)) throw new Error("STL 模型高度為 0，無法縮放");

  const scale = heightMm / height;
  const origin = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];

  // 等比例縮放不會改變法向量方向，只需要改頂點
  forEachVertexOffset(triangles, (offset) => {
    for (let axis = 0; axis < 3; axis++) {
      const value = buffer.readFloatLE(offset + axis * 4);
      buffer.writeFloatLE((value - origin[axis]) * scale, offset + axis * 4);
    }
  });

  const dimensionsMm = [0, 1, 2].map(
    (axis) => Math.round((max[axis] - min[axis]) * scale * 10) / 10,
  ) as StlInfo["dimensionsMm"];

  return { buffer, info: { triangles, dimensionsMm } };
}

function forEachVertexOffset(triangles: number, fn: (offset: number) => void) {
  for (let i = 0; i < triangles; i++) {
    const base = HEADER_BYTES + i * TRIANGLE_BYTES + 12;
    for (let v = 0; v < 3; v++) fn(base + v * 12);
  }
}

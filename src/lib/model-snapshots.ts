"use client";

import * as THREE from "three";
import type { MeshData } from "@/lib/mesh";

// 在瀏覽器把模型從 4 個角度拍成圖片（給 AI 看、也顯示在頁面上）
// 模型座標是 Z 軸朝上、單位 mm；格線畫在平台高度，讓 AI 看得出哪一面貼平台
// 角度以「列印平台」為準（Bambu 平台前方是 -Y），不是模型自己的正面：模型可能轉了方向擺

export const SNAPSHOT_VIEWS = [
  { id: "front", label: "從平台前方", dir: [0, -1, 0.15] },
  { id: "side", label: "從平台右側", dir: [1, 0, 0.15] },
  { id: "top", label: "從正上方", dir: [0, -0.001, 1] },
  { id: "iso", label: "從右前上方", dir: [1, -1, 0.9] },
] as const;

export type Snapshot = { id: string; label: string; blob: Blob; url: string };

const SIZE = 768;

export async function renderSnapshots(meshes: MeshData[]): Promise<Snapshot[]> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4f5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9ca3af, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sun);

  const material = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  const group = new THREE.Group();
  for (const m of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(m.indices, 1));
    // 三角形不共用頂點時（STL），computeVertexNormals 就是平面法向量，邊緣會比較清楚
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, material));
  }
  scene.add(group);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1);

  // 平台格線（XY 平面、在模型最低點）
  const gridSize = Math.max(size.x, size.y) * 1.8 + 20;
  const grid = new THREE.GridHelper(gridSize, 12, 0x9ca3af, 0xd4d4d8);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(center.x, center.y, box.min.z);
  scene.add(grid);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
  camera.up.set(0, 0, 1);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(35 / 2)) * 1.1;

  const snapshots: Snapshot[] = [];
  try {
    for (const view of SNAPSHOT_VIEWS) {
      const dir = new THREE.Vector3(...view.dir).normalize();
      camera.position.copy(center).addScaledVector(dir, distance);
      // 從正上方往下看時，「上」改成 +Y，畫面才不會轉向
      camera.up.set(0, view.id === "top" ? 1 : 0, view.id === "top" ? 0 : 1);
      camera.lookAt(center);
      sun.position.copy(camera.position).add(new THREE.Vector3(radius, -radius, radius * 2));
      renderer.render(scene, camera);
      const blob = await new Promise<Blob>((resolve, reject) =>
        renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("截圖失敗"))), "image/jpeg", 0.9),
      );
      snapshots.push({ id: view.id, label: view.label, blob, url: URL.createObjectURL(blob) });
    }
  } finally {
    renderer.dispose();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    material.dispose();
  }
  return snapshots;
}

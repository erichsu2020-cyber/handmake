"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { ModelFormat } from "@/lib/print-settings";

const BASE_MATERIAL = { color: 0xb8bcc4, roughness: 0.6, metalness: 0.05 };

async function loadModel(url: string, format: ModelFormat): Promise<THREE.Object3D> {
  switch (format) {
    case "STL": {
      const geometry = await new STLLoader().loadAsync(url);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(BASE_MATERIAL));
      mesh.rotation.x = -Math.PI / 2; // STL 是 Z 軸朝上，three.js 是 Y 軸朝上
      return mesh;
    }
    case "3MF": {
      const group = await new ThreeMFLoader().loadAsync(url);
      group.rotation.x = -Math.PI / 2;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = new THREE.MeshStandardMaterial(BASE_MATERIAL);
      });
      return group;
    }
    case "OBJ": {
      const group = await new OBJLoader().loadAsync(url);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const hasColors = Boolean(child.geometry.getAttribute("color"));
          child.geometry.computeVertexNormals();
          child.material = new THREE.MeshStandardMaterial({
            ...BASE_MATERIAL,
            ...(hasColors ? { color: 0xffffff, vertexColors: true } : {}),
          });
        }
      });
      return group;
    }
  }
}

export default function ModelPreview({ url, format }: { url: string; format: ModelFormat }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 2, 1.5);
    scene.add(light);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    loadModel(url, format)
      .then((object) => {
        if (disposed) return;
        scene.add(object);

        // 讓鏡頭剛好框住整個模型，並加上一個印表機平台般的格線
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z);
        camera.position.set(center.x + radius * 1.2, center.y + radius * 0.8, center.z + radius * 1.6);
        controls.target.copy(center);

        const grid = new THREE.GridHelper(radius * 2, 20, 0x888888, 0xcccccc);
        grid.position.y = box.min.y;
        scene.add(grid);
        setState("ready");
      })
      .catch((error) => {
        console.error("載入 3D 預覽失敗", error);
        if (!disposed) setState("error");
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, format]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
      <div ref={containerRef} className="absolute inset-0" />
      {state !== "ready" && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
          {state === "loading" ? "載入 3D 預覽中…" : "無法顯示預覽，請直接下載檔案"}
        </p>
      )}
      {state === "ready" && (
        <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs text-zinc-500">
          拖曳旋轉・滾輪縮放
        </p>
      )}
    </div>
  );
}

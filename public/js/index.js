import * as THREE from "https://esm.sh/three@0.180.0";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

// TODO: 如果檔名不是 tree.glb，請改成實際檔名
const MODEL_URL = "/assets/models/tree.glb";

let scene, camera, renderer;
let treeModel = null;

function initThree() {
  const container = document.getElementById("treeCanvasContainer");
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight || window.innerHeight * 0.7;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f3f3);

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 1.5, 4);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  // 簡單光源
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemiLight.position.set(0, 1, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(2, 4, 2);
  scene.add(dirLight);

  // 載入 GLTF 模型
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      treeModel = gltf.scene;

      // 依照模型實際大小做簡單縮放與置中
      treeModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 先估一個適中的縮放及位置，之後可依實際模型調整
      treeModel.scale.set(1.4, 1.4, 1.4);
      treeModel.position.set(0, -1.2, 0);

      scene.add(treeModel);
    },
    undefined,
    (error) => {
      console.error("載入 3D 樹模型失敗：", error);
    }
  );

  window.addEventListener("resize", onWindowResize);
  animate();
}

function onWindowResize() {
  const container = document.getElementById("treeCanvasContainer");
  if (!container || !camera || !renderer) return;

  const width = container.clientWidth;
  const height = container.clientHeight || window.innerHeight * 0.7;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);

  if (treeModel) {
    treeModel.rotation.y += 0.0025; // 緩慢旋轉
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// （如果未來要在首頁顯示最新回報，可在這裡加 fetchReports）

document.addEventListener("DOMContentLoaded", () => {
  initThree();
});

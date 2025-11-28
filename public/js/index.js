import * as THREE from "https://esm.sh/three@0.180.0";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

console.log("[UrbanSeed] index.js loaded");

// TODO: 如果檔名不是 tree.glb，請改成實際檔名
const MODEL_URL = "./assets/models/tree.glb";

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

  // 測試用立方體：如果看得到它，代表場景正常
  const testGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const testMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const testCube = new THREE.Mesh(testGeo, testMat);
  testCube.position.set(-1, 0, 0);
  scene.add(testCube);
  console.log("[UrbanSeed] test cube added");

  // 載入 GLTF 模型
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      console.log("[UrbanSeed] GLTF loaded:", gltf);

      treeModel = gltf.scene;

      // 用 bounding box 檢查模型大小
      const box = new THREE.Box3().setFromObject(treeModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      console.log("[UrbanSeed] Tree model size:", size);

      // 依照模型實際大小做簡單縮放與置中
      treeModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 先用一個保守縮放值，避免模型太大或太小
      const maxDim = Math.max(size.x, size.y, size.z);
      const scaleFactor = maxDim > 0 ? 2.5 / maxDim : 1.0;
      treeModel.scale.setScalar(scaleFactor);

      // 讓模型大致站在地板上
      box.setFromObject(treeModel);
      const center = new THREE.Vector3();
      box.getCenter(center);
      treeModel.position.set(-center.x, -box.min.y, -center.z);

      scene.add(treeModel);
    },
    undefined,
    (error) => {
      console.error("[UrbanSeed] 載入 3D 樹模型失敗：", error);
      console.error("[UrbanSeed] 請確認 MODEL_URL 是否正確：", MODEL_URL);
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

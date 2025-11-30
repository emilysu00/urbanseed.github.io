import * as THREE from "https://esm.sh/three@0.180.0";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";

console.log("[UrbanSeed] index.js loaded");

// TODO: 如果檔名不是 tree.glb，請改成實際檔名
const MODEL_URL = "./assets/models/tree.glb";
const PHOTO_TEXTURES = [
  "./assets/images/tree-float-1.jpg",
  "./assets/images/tree-float-2.jpg",
  "./assets/images/tree-float-3.jpg",
  "./assets/images/tree-float-4.jpg",
  "./assets/images/tree-float-5.jpg",
  "./assets/images/tree-float-6.jpg",
  "./assets/images/tree-float-7.jpg",
  "./assets/images/tree-float-8.jpg",
  "./assets/images/tree-float-9.jpg",
  "./assets/images/tree-float-10.jpg",
];

let scene, camera, renderer;
let treeModel = null;
let controls = null;
let photoPlanes = [];
let codeTreeCanvas = null;
let codeTreeCtx = null;
let codeTreeTempCanvas = null;
let codeTreeTempCtx = null;
let codeTreeMaskImg = null;
let codeTreeMaskReady = false;
let codeColumns = [];
let codeChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*+-/<>?";
let codeFontSize = 10;
let codeColumnScale = 0.9;
let codeRowHeight = 12;
let codeTreeLastFrameTime = 0;
const CODE_TREE_FRAME_INTERVAL = 1000 / 20; // 20 FPS

// === 2. 初始化背景 ===
function initCodeTreeBackground() {
  codeTreeCanvas = document.getElementById("code-tree-canvas");
  if (!codeTreeCanvas) {
    console.warn("[CodeTree] 沒有找到 #code-tree-canvas，不啟用背景亂碼樹");
    return;
  }

  codeTreeCtx = codeTreeCanvas.getContext("2d");

  codeTreeTempCanvas = document.createElement("canvas");
  codeTreeTempCtx = codeTreeTempCanvas.getContext("2d");

  resizeCodeTreeCanvas();
  window.addEventListener("resize", resizeCodeTreeCanvas);

  // 遮罩圖片（建議 tree-mask.png 是「透明背景＋白色樹形」PNG）
  codeTreeMaskImg = new Image();
  codeTreeMaskImg.onload = () => {
    console.log("[CodeTree] mask loaded");
    codeTreeMaskReady = true;
  };
  codeTreeMaskImg.onerror = () => {
    console.warn(
      "[CodeTree] 遮罩載入失敗：assets/images/tree-mask.png，將只顯示一般亂碼雨"
    );
    codeTreeMaskReady = false;
  };
  codeTreeMaskImg.src = "assets/images/tree-mask.png";

  initCodeColumns();
  startCodeTreeLoop();

  console.log("[CodeTree] initialized");
}

// === 3. resize canvas ===
function resizeCodeTreeCanvas() {
  if (!codeTreeCanvas) return;

  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;

  codeTreeCanvas.width = cssWidth;
  codeTreeCanvas.height = cssHeight;
  codeTreeCanvas.style.width = cssWidth + "px";
  codeTreeCanvas.style.height = cssHeight + "px";

  if (codeTreeCtx) {
    codeTreeCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  if (codeTreeTempCanvas && codeTreeTempCtx) {
    codeTreeTempCanvas.width = cssWidth;
    codeTreeTempCanvas.height = cssHeight;
  }

  initCodeColumns();
  console.log("[CodeTree] resize:", { width: cssWidth, height: cssHeight });
}

// === 4. 建立每一欄亂碼的資料 ===
function initCodeColumns() {
  if (!codeTreeCanvas) return;

  const width = codeTreeCanvas.width || window.innerWidth;
  const spacing = codeFontSize * codeColumnScale;
  const columns = Math.floor(width / spacing);
  codeColumns = [];

  for (let i = 0; i < columns; i++) {
    codeColumns.push({
      x: i * spacing,
      y: Math.random() * -500, // 從畫面上方亂數開始
      speed: 1 + Math.random() * 1.5,
    });
  }
}

// === 5. 畫一幀亂碼樹 ===
function drawCodeTreeFrame() {
  if (!codeTreeCtx || !codeTreeCanvas) return;

  const width = codeTreeCanvas.width;
  const height = codeTreeCanvas.height;
  const spacing = codeFontSize * codeColumnScale;

  if (codeColumns.length !== Math.floor(width / spacing)) {
    initCodeColumns();
  }

  const ctx = codeTreeTempCtx || codeTreeCtx;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, width, height);

  ctx.font = `${codeFontSize}px monospace`;
  ctx.textBaseline = "top";

  for (const col of codeColumns) {
    let y = col.y;
    while (y < height + codeRowHeight) {
      const ch = codeChars[Math.floor(Math.random() * codeChars.length)] || "0";
      const alpha = 0.15 + Math.random() * 0.15;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`; // 較輕的亂碼顏色
      ctx.fillText(ch, col.x, y);
      y += codeRowHeight;
    }

    col.y += col.speed;
    if (col.y > height + 200) {
      col.y = Math.random() * -400;
    }
  }

  // 如果 mask 沒準備好，就直接把整個亂碼畫到主 canvas
  if (!codeTreeMaskReady || !codeTreeTempCanvas || !codeTreeMaskImg) {
    if (codeTreeTempCanvas && codeTreeTempCtx && codeTreeCtx !== ctx) {
      codeTreeCtx.clearRect(0, 0, width, height);
      codeTreeCtx.drawImage(codeTreeTempCanvas, 0, 0, width, height);
    }
    return;
  }

  // 套用遮罩：只保留樹形範圍的亂碼
  const tctx = codeTreeTempCtx;
  tctx.save();
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(codeTreeMaskImg, 0, 0, width, height);
  tctx.restore();

  codeTreeCtx.clearRect(0, 0, width, height);
  codeTreeCtx.drawImage(codeTreeTempCanvas, 0, 0, width, height);
}

// === 6. 動畫 loop ===
function startCodeTreeLoop() {
  function loop(timestamp) {
    requestAnimationFrame(loop);

    if (!codeTreeLastFrameTime) {
      codeTreeLastFrameTime = timestamp;
    }

    const delta = timestamp - codeTreeLastFrameTime;
    if (delta < CODE_TREE_FRAME_INTERVAL) {
      return;
    }
    codeTreeLastFrameTime = timestamp;

    drawCodeTreeFrame();
  }
  requestAnimationFrame(loop);
}

function createPhotoPlanes(parent) {
  const loader = new THREE.TextureLoader();

  // 預先定義 10 個平面在樹旁邊的位置
  const positions = [
    // 上排：從左樹梢 → 右樹梢
    new THREE.Vector3(-2.6, 4.9, 0.8),
    new THREE.Vector3(-1.4, 5.1, -1),
    new THREE.Vector3(0.2, 5.0, 0.7),
    new THREE.Vector3(1.8, 4.9, -0.9),
    new THREE.Vector3(3.0, 4.7, 1),

    // 中排：稍微低一點，依然分散在左右
    new THREE.Vector3(-2.3, 4.2, -0.5),
    new THREE.Vector3(-0.8, 4.3, 0.9),
    new THREE.Vector3(1.0, 4.2, -1),
    new THREE.Vector3(2.5, 4.1, 0.8),

    // 下排：中間略低一張，接近樹幹但不要太下
    new THREE.Vector3(0.2, 3.7, -0.7),
  ];

  PHOTO_TEXTURES.forEach((url, index) => {
    loader.load(
      url,
      (texture) => {
        // 依照圖片原始比例建立平面，避免被硬拉扯
        let geo;
        const img = texture.image;
        if (img && img.width && img.height) {
          const aspect = img.width / img.height; // 寬 / 高
          const baseHeight = 1.0; // 你可以視覺上再微調高度
          const width = baseHeight * aspect;
          geo = new THREE.PlaneGeometry(width, baseHeight);
        } else {
          // 如果讀不到尺寸，就退回原本的預設值
          geo = new THREE.PlaneGeometry(0.7, 1.0);
        }
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(geo, mat);

        const pos = positions[index] || new THREE.Vector3(0, 1.5, 0);
        plane.position.copy(pos);

        // 稍微旋轉一點點，讓它不是完全正對 Z 軸
        plane.rotation.y =
          index < 5
            ? THREE.MathUtils.degToRad(20)
            : THREE.MathUtils.degToRad(-20);

        parent.add(plane);
        photoPlanes.push(plane);
      },
      undefined,
      (err) => {
        console.error("[UrbanSeed] 載入照片貼圖失敗：", url, err);
      }
    );
  });
}

function initThree() {
  const container = document.getElementById("treeCanvasContainer");
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight || window.innerHeight * 0.7;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 1.2, 4);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // 透明背景
  renderer.shadowMap.enabled = false;
  renderer.domElement.style.background = "transparent";
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  // 新增：滑鼠控制
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  // 限制上下角度，不用看到樹底 / 天空太多
  controls.minPolarAngle = Math.PI / 2 - 0.3;
  controls.maxPolarAngle = Math.PI / 2 + 0.3;
  // 限制縮放距離
  controls.minDistance = 2;
  controls.maxDistance = 4.5;

  renderer.domElement.style.cursor = "grab";
  // 一開始就看向樹身中間
  controls.target.set(0, 1.0, 0);
  controls.update();

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
      const scaleFactor = maxDim > 0 ? 4.5 / maxDim : 1.0;
      treeModel.scale.setScalar(scaleFactor);

      // 重新計算模型的 bounding box
      box.setFromObject(treeModel);
      const center = new THREE.Vector3();
      box.getCenter(center);

      // 先把模型「整體中心」平移到原點 (0,0,0)
      treeModel.position.set(-center.x, -center.y, -center.z);

      // 再微微往下移一點，讓樹根靠近畫面下方
      treeModel.position.y -= -1.2;

      scene.add(treeModel);

      // 如果 OrbitControls 已經建立，讓 target 對準樹身中段
      if (controls) {
        controls.target.set(0, 1.0, 0);
        controls.update();
      }

      // 在模型旁建立照片平面
      createPhotoPlanes(treeModel);
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

  // 讓樹緩慢自轉（速度可以再調整）
  if (treeModel) {
    treeModel.rotation.y += 0.0015;
  }

  if (controls) {
    controls.update();
  }

  if (photoPlanes && photoPlanes.length && camera) {
    photoPlanes.forEach((plane) => {
      plane.lookAt(camera.position);
    });
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function initMobileHeader() {
  const body = document.body;
  const searchToggle = document.querySelector(".us-mobile-search-toggle");
  const menuToggle = document.querySelector(".us-mobile-menu-toggle");
  const navOverlay = document.querySelector(".us-mobile-nav-overlay");
  const navClose = document.querySelector(".us-mobile-nav-close");
  const navPanel = document.querySelector(".us-mobile-nav-panel");
  const searchInput = document.querySelector(".us-mobile-search-input");
  const searchSubmit = document.querySelector(".us-mobile-search-submit");

  // 統一控制搜尋展開 / 收合
  function toggleSearch() {
    body.classList.toggle("us-mobile-search-open");
    if (body.classList.contains("us-mobile-search-open") && searchInput) {
      searchInput.focus();
    }
  }

  // 左邊小搜尋按鈕：負責打開（或關閉）搜尋
  if (searchToggle) {
    searchToggle.addEventListener("click", toggleSearch);
  }

  // 搜尋欄右側的搜尋 icon：展開後也可以關閉（再按一次）
  if (searchSubmit) {
    searchSubmit.addEventListener("click", (event) => {
      event.preventDefault();
      toggleSearch();
    });
  }

  // menu 開關
  function closeMenu() {
    body.classList.remove("us-mobile-menu-open");
  }

  if (menuToggle && navOverlay) {
    menuToggle.addEventListener("click", () => {
      body.classList.add("us-mobile-menu-open");
    });

    // 點選浮層背景（panel 外面）也關閉
    navOverlay.addEventListener("click", (event) => {
      if (event.target === navOverlay) {
        closeMenu();
      }
    });
  }

  if (navClose) {
    navClose.addEventListener("click", closeMenu);
  }

  // 點選選單項目後關閉選單
  if (navPanel) {
    navPanel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }
}

// （如果未來要在首頁顯示最新回報，可在這裡加 fetchReports）

document.addEventListener("DOMContentLoaded", () => {
  initThree();
  initCodeTreeBackground();
  initMobileHeader();
});

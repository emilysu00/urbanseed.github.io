import * as THREE from "https://esm.sh/three@0.180.0";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { RGBELoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/RGBELoader.js";

console.log("[UrbanSeed] index.js loaded");

const MODEL_URL = "./assets/models/tree.glb";
const HDR_URL = "./assets/hdr/nature.hdr";

// 可調參數（你之後只要改這裡就好）
const RENDER_TRANSPARENT = true; // true = canvas 透明，吃你網站背景
const SHOW_HDR_AS_BACKGROUND = false; // true = 直接顯示 HDR 當背景
const ENV_INTENSITY = 3; // 反射/折射強度
// Floating photos 微調：讓你可以手動把 group 中心點往左右調
const PHOTO_CENTER_OFFSET_Z = 6; // 單位是 three.js 世界座標（建議先試 0.1 / -0.1）
const PHOTO_CENTER_OFFSET_X = 1;
const GLASS_PRESET = {
  transmission: 1.0,
  ior: 1.45,
  thickness: 0.35,
  roughness: 0.06,
  metalness: 0.0,
  envMapIntensity: ENV_INTENSITY,
};

// 彩球（Neon 粒子）設定
const NEON = {
  enabled: false, // 預設關閉彩球
  count: 1800,
  sizeMin: 2.0,
  sizeMax: 7.0,
  opacity: 0.85,
};

let scene, camera, renderer, controls;
let treeModel = null;
const clock = new THREE.Clock();
let resizeObserver = null;
let __threeInited = false;
let pmrem = null;
let envMap = null;

function frameToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const cameraDist = maxDim * 3.0;

  camera.position.set(0, maxDim * 1, cameraDist);
  controls.target.set(0, maxDim * 0.45, 0);
  controls.minDistance = cameraDist * 0.25;
  controls.maxDistance = cameraDist * 0.35;
  controls.update();
}

function ensureContainerLayout(container) {
  container.style.position = "relative";
  container.style.overflow = "hidden";
  container.style.zIndex = "2";
}

function createRenderer(container) {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0xffffff, RENDER_TRANSPARENT ? 0.0 : 1.0);

  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.zIndex = "2";
  renderer.domElement.style.pointerEvents = "auto";

  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(renderer.domElement);
}

function addLoadingSphere() {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 24, 16),
    new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
  );
  sphere.name = "__LOADING_SPHERE__";
  sphere.position.set(0, 0.5, 0);
  scene.add(sphere);
}

function addLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 6, 4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-4, 5, -3);
  scene.add(rim);
}

async function loadHDREnvironment() {
  if (!renderer || !scene) return;

  if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  try {
    const hdr = await new RGBELoader().loadAsync(HDR_URL);
    hdr.mapping = THREE.EquirectangularReflectionMapping;

    envMap = pmrem.fromEquirectangular(hdr).texture;

    scene.environment = envMap;
    if (SHOW_HDR_AS_BACKGROUND) scene.background = envMap;

    hdr.dispose();
  } catch (e) {
    console.warn("[UrbanSeed] HDR load failed, fallback to lights only:", e);
  }
}

function makeGlassMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xf1ffdf,
    metalness: 0.6,
    roughness: 0.01,

    transmission: 1.2,
    ior: 3,
    thickness: 2,

    envMapIntensity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });

  return mat;
}

// 彩球生成位置（會掛在傳入的 object3D 周圍）
function addNeonParticlesTo(object3D) {
  if (!NEON.enabled) return null;

  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const spread = Math.max(size.x, size.y, size.z) * 0.55;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(NEON.count * 3);
  const colors = new Float32Array(NEON.count * 3);
  const sizes = new Float32Array(NEON.count);

  const neonPalette = [
    new THREE.Color("#CEFF23"),
    new THREE.Color("#00F5FF"),
    new THREE.Color("#FF3DFF"),
    new THREE.Color("#7CFF00"),
  ];

  for (let i = 0; i < NEON.count; i++) {
    const ix = i * 3;

    const x = center.x + (Math.random() * 2 - 1) * spread;
    const y = center.y + (Math.random() * 2 - 1) * spread * 0.5;
    const z = center.z + (Math.random() * 2 - 1) * spread;

    positions[ix + 0] = x;
    positions[ix + 1] = y;
    positions[ix + 2] = z;

    const c = neonPalette[(Math.random() * neonPalette.length) | 0];
    colors[ix + 0] = c.r;
    colors[ix + 1] = c.g;
    colors[ix + 2] = c.b;

    sizes[i] = NEON.sizeMin + Math.random() * (NEON.sizeMax - NEON.sizeMin);
  }

  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: NEON.opacity },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2.0) },
    },
    vertexShader: `
      attribute float aSize;
      attribute vec3 aColor;
      varying vec3 vColor;

      uniform float uPixelRatio;

      void main() {
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float dist = -mvPosition.z;
        gl_PointSize = aSize * uPixelRatio * (300.0 / dist);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      uniform float uOpacity;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= uOpacity;

        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.name = "__NEON_PARTICLES__";
  return points;
}

function setupCameraAndControls(container) {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);

  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 500);
  camera.position.set(0, 1.2, 6);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = Math.PI / 2 - THREE.MathUtils.degToRad(5);
  controls.maxPolarAngle = Math.PI / 2 + THREE.MathUtils.degToRad(5);
}

function loadTree() {
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      treeModel = gltf.scene;
      treeModel.visible = true;

      // 模型材質開始（玻璃） //
      const glass = makeGlassMaterial();
      treeModel.traverse((child) => {
        if (child.isMesh) {
          const mat = glass.clone();
          mat.side = THREE.DoubleSide;
          if (envMap) mat.envMap = envMap;
          child.material = mat;
          child.frustumCulled = false;
        }
      });
      // 模型材質結束 //

      const box = new THREE.Box3().setFromObject(treeModel);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      const scaleFactor = (7.5 / maxDim) * 2.6;
      treeModel.scale.setScalar(scaleFactor);

      const boxScaled = new THREE.Box3().setFromObject(treeModel);
      const centerScaled = new THREE.Vector3();
      boxScaled.getCenter(centerScaled);

      treeModel.position.y = -boxScaled.min.y;
      treeModel.position.x = -centerScaled.x;
      treeModel.position.z = -centerScaled.z;
      treeModel.position.y -= 1.5;

      scene.add(treeModel);
      addFloatingPhotos(treeModel);

      const loadingSphere = scene.getObjectByName("__LOADING_SPHERE__");
      if (loadingSphere) scene.remove(loadingSphere);

      frameToObject(treeModel);
    },
    undefined,
    (err) => {
      console.error("[UrbanSeed] GLTF load failed:", err);
      console.error("[UrbanSeed] MODEL_URL =", MODEL_URL);

      // 樹載不出來時才啟用彩球當備援
      NEON.enabled = true;
      spawnNeonFallback();
    }
  );
}

function onResize() {
  const container = document.getElementById("treeCanvasContainer");
  if (!container || !camera || !renderer) return;

  const rect = container.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);

  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (treeModel) treeModel.rotation.y += dt * 0.18;

  if (controls) controls.update();
  renderer.render(scene, camera);
}

function addFloatingPhotos(treeModel) {
  // === Debug: 確保能看到 function 有跑 ===
  console.log("[UrbanSeed] addFloatingPhotos() called");

  // 用 bounding box 自動估算樹的尺寸（避免 radius/size 太小而藏進樹裡）
  const box = new THREE.Box3().setFromObject(treeModel);
  const size = new THREE.Vector3();
  const centerWorld = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centerWorld);

  // 把世界座標 center 轉回 treeModel 的 local（因為我們把 group 掛在 treeModel 上）
  const centerLocal = treeModel.worldToLocal(centerWorld.clone());
  centerLocal.z += PHOTO_CENTER_OFFSET_Z;
  centerLocal.x += PHOTO_CENTER_OFFSET_X;

  // 也把 min/max 轉 local（用來算高度範圍）
  const minLocal = treeModel.worldToLocal(box.min.clone());
  const maxLocal = treeModel.worldToLocal(box.max.clone());

  const maxDim = Math.max(size.x, size.y, size.z);

  // ✅ 自動參數：避免“樹很大但照片半徑只有 1.2”導致看不到
  // === 圖片清單：要增加照片就加在這裡 ===
  const PHOTO_URLS = [
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
    "./assets/images/tree-float-11.jpg",
    "./assets/images/tree-float-12.jpg",
    "./assets/images/tree-float-13.jpg",
    "./assets/images/tree-float-14.jpg",
    "./assets/images/tree-float-15.jpg",
    "./assets/images/tree-float-16.jpg",
    // 之後要加就繼續：
    // "./assets/images/tree-float-11.jpg",
    // "./assets/images/tree-float-12.jpg",
  ];
  const photoCount = PHOTO_URLS.length;
  const radius = Math.max(size.x, size.z) * 0.9; // 環繞半徑 = 樹寬的比例
  const heightStart = minLocal.y + (maxLocal.y - minLocal.y) * 0.25;
  const heightRange = (maxLocal.y - minLocal.y) * 0.55;

  // 圖片尺寸也跟著樹比例走（不會小到看不到）
  const planeW = maxDim * 0.22;
  const planeH = planeW * 1.35;

  const tiltRad = THREE.MathUtils.degToRad(-10);

  // === 兩層分佈（你要的 two tiers）===
  const LAYERS = 2; // 兩層
  const LAYER_GAP = heightRange * 0.3; // 兩層的高度間距（可調）
  const LAYER_JITTER_Y = heightRange * 0.04; // 每張圖在層內的微抖動（很小，避免太死）

  // === 同層往外疊（stack outward）===
  const STACK_STEP = Math.max(size.x, size.z) * 0.08; // 每張往外加多少（可調）
  const STACK_JITTER = STACK_STEP * 0.25; // 外疊的微抖動（避免太等距像UI）
  // 讓照片永遠離開樹幹表面一點點，避免切進樹造成“突然被吞”
  const PHOTO_CLEARANCE = Math.max(size.x, size.z) * 0.06; // 可調：0.04~0.10

  // 整體照片群往上移（你可以調這個）
  const PHOTO_GROUP_OFFSET_Y = heightRange * 0.25; // 建議先 0.2~0.35 間微調

  const photoGroup = new THREE.Group();
  photoGroup.name = "floatingPhotos";

  // Debug：加一個小小的 Axes，方便確認 group 位置在哪
  const axes = new THREE.AxesHelper(maxDim * 0.1);
  axes.position.copy(centerLocal);
  photoGroup.add(axes);

  // 用 LoadingManager 抓出路徑載入錯誤（你就會在 console 看到哪張圖 404）
  const manager = new THREE.LoadingManager();
  manager.onError = (url) => {
    console.error("[UrbanSeed] Texture failed to load:", url);
  };
  manager.onLoad = () => {
    console.log("[UrbanSeed] All floating photo textures loaded.");
  };

  const loader = new THREE.TextureLoader(manager);

  for (let i = 0; i < photoCount; i++) {
    const url = PHOTO_URLS[i];
    const material = new THREE.MeshBasicMaterial({
      map: null, // ✅ 先留空，等貼圖 load 完再塞
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });

    const geometry = new THREE.PlaneGeometry(1, 1); // 用 1x1 當基底，之後用 scale 依圖片比例縮放
    const mesh = new THREE.Mesh(geometry, material);

    // 先給一個 fallback scale，避免貼圖還沒載完時 mesh=0 看不到
    mesh.scale.set(planeW, planeH, 1);

    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;

      const img = tex.image;
      if (img && img.width && img.height) {
        const aspect = img.height / img.width; // 高/寬
        mesh.scale.set(planeW, planeW * aspect, 1); // 寬固定用 planeW，高用比例算
      } else {
        mesh.scale.set(planeW, planeH, 1);
      }

      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
    });

    // 放射狀角度（帶一點錯開，避免完全平均太像 UI）
    const angle = (i / photoCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;

    // --- 決定這張圖屬於哪一層（0=下層, 1=上層） ---
    const layerIndex = i % LAYERS;

    // --- 每層的基準高度：下層在 heightStart，上層在 heightStart + LAYER_GAP ---
    const layerY = heightStart + layerIndex * LAYER_GAP;

    // 層內只給非常小的抖動，避免你看到第三層
    const y =
      layerY + PHOTO_GROUP_OFFSET_Y + (Math.random() * 2 - 1) * LAYER_JITTER_Y;

    // --- 同層往外疊：同一層的第幾張（例如 i=0,2,4... 都是下層） ---
    const stackIndex = Math.floor(i / LAYERS);

    // 半徑 = 基準 radius + stackIndex * step（加一點 jitter 讓它更像參考圖的“疊片”）
    const r =
      radius + stackIndex * STACK_STEP + (Math.random() * 2 - 1) * STACK_JITTER;

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    // 以樹幹中心為基準放射出去（local）
    mesh.position.set(centerLocal.x + x, y, centerLocal.z + z);
    // 沿著朝外方向再推一點，避免和樹幹相交
    const outward = new THREE.Vector3(x, 0, z).normalize();
    mesh.position.add(outward.clone().multiplyScalar(PHOTO_CLEARANCE));

    // ✅ 關鍵：朝外（不看相機）
    const lookTarget = mesh.position
      .clone()
      .add(outward.clone().multiplyScalar(10));
    mesh.lookAt(lookTarget);

    // 微微向上傾斜 2–3 度
    mesh.rotateX(-tiltRad);

    // ✅ 深度排序保險：讓圖片不容易被樹完全吃掉
    mesh.renderOrder = 10 + i;

    // Debug：若你仍看不到，先把材質染色（不影響貼圖）
    // material.color.set(0xffffff);

    photoGroup.add(mesh);
  }

  // 把整群加在樹上：會跟樹一起轉
  treeModel.add(photoGroup);

  console.log("[UrbanSeed] floatingPhotos group added.", {
    size: { x: size.x, y: size.y, z: size.z },
    radius,
    planeW,
    planeH,
  });
}

async function initThree() {
  if (__threeInited) return;
  const container = document.getElementById("treeCanvasContainer");
  if (!container) {
    console.error("[UrbanSeed] #treeCanvasContainer not found");
    return;
  }
  __threeInited = true;

  ensureContainerLayout(container);

  scene = new THREE.Scene();
  createRenderer(container);
  setupCameraAndControls(container);

  addLights();
  addLoadingSphere();
  await loadHDREnvironment();
  loadTree();

  resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(container);
  window.addEventListener("resize", onResize);
  animate();
}

document.addEventListener("DOMContentLoaded", initThree);

// 樹載入失敗時，用隱形方塊作為彩球的參考範圍
function spawnNeonFallback() {
  if (!scene) return;
  const anchor = new THREE.Group();
  anchor.name = "__NEON_FALLBACK_ANCHOR__";

  const bounds = new THREE.Mesh(
    new THREE.BoxGeometry(4, 5, 4),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  anchor.add(bounds);
  scene.add(anchor);

  const neon = addNeonParticlesTo(anchor);
  if (neon) scene.add(neon);
}

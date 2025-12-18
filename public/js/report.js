// public/js/report.js

const reportForm = document.getElementById("reportForm");
const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photoPreview");
const problemTypeSelect = document.getElementById("problemType");
const targetTypeSelect = document.getElementById("targetType");
const treeIdInput = document.getElementById("treeId");
const contactInput = document.getElementById("contact");
const riskDisplay = document.getElementById("riskDisplay");
const formMessage = document.getElementById("formMessage");
const fakeScanStatus = document.getElementById("fakeScanStatus");
let fakeScanOverlayEl = null;
let scanP5Instance = null; // p5.js WebGL 掃描動畫實例（若已存在則保留）
let isFakeScanning = false; // 避免掃描重複啟動
let scanLabelEl = null; // 顯示英文學名／狀態的小字
let scanLabelEls = []; // 多個小字（每個框一個）
let scanLabelsWrapEl = null; // labels 容器
const photoDropzone = document.getElementById("photoDropzone");

function getPhotoStage() {
  if (!photoPreview) return null;
  return photoPreview.querySelector(".photo-stage");
}

function mountPhotoToStage(imgEl) {
  if (!photoPreview || !imgEl) return null;
  photoPreview.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "photo-stage";
  stage.appendChild(imgEl);
  photoPreview.appendChild(stage);
  return stage;
}

function showSubmitModalAndGoHome() {
  const old = document.getElementById("usSubmitModal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "usSubmitModal";
  modal.className = "us-modal";
  modal.innerHTML = `
    <div class="us-modal-backdrop"></div>
    <div class="us-modal-panel" role="dialog" aria-modal="true">
      <h3 class="us-modal-title">已收到你的回報 ✅</h3>
      <p class="us-modal-desc">我們已建立一筆回報紀錄（prototype），接下來將帶你回到首頁。</p>
      <div class="us-modal-actions">
        <button type="button" class="btn-primary" id="usGoHomeBtn">回首頁</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const go = () => {
    window.location.href = "./index.html";
  };
  modal.querySelector("#usGoHomeBtn")?.addEventListener("click", go);
  modal.querySelector(".us-modal-backdrop")?.addEventListener("click", go);

  setTimeout(go, 1200);
}

// 掃描框會跳到的各個位置（UV 座標 0~1） + 對應文字
// NOTE: 靜態備援 targets（當照片還沒載入 / 偵測失敗時用）
const scanTargetsStatic = [
  { x: 0.2, y: 0.86, label: "Root flare / heaving" },
  { x: 0.5, y: 0.84, label: "Soil surface check" },
  { x: 0.8, y: 0.82, label: "Pavement / root conflict" },

  { x: 0.18, y: 0.64, label: "Lower trunk decay" },
  { x: 0.5, y: 0.6, label: "Mid trunk stability" },
  { x: 0.82, y: 0.62, label: "Lower crown stress" },

  { x: 0.22, y: 0.42, label: "Branch attachment" },
  { x: 0.5, y: 0.4, label: "Crown symmetry" },
  { x: 0.78, y: 0.38, label: "Lateral branch check" },

  { x: 0.26, y: 0.22, label: "Canopy density" },
  { x: 0.5, y: 0.2, label: "Leader vitality" },
  { x: 0.74, y: 0.18, label: "Upper crown defects" },
];

// 由「照片本身」分析出來的 targets（會覆蓋 static）
let scanTargetsDynamic = [];

// label 池：用來給動態偵測點分配看起來像真的 metadata
const scanLabelPool = [
  "Bark texture / edge density",
  "Chlorophyll cluster (approx.)",
  "Trunk axis hypothesis",
  "Canopy gradient check",
  "Root flare boundary",
  "Soil/green segmentation",
  "Branch junction candidate",
  "Occlusion boundary",
  "Surface roughness proxy",
  "Color variance anomaly",
  "Vertical structure cue",
  "Shadow boundary",
  "Background separation",
  "Lichen / discoloration",
  "Crown density proxy",
  "Stress signature (weak)",
];

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// --- 超輕量「假 machine vision」：用縮圖做顏色（綠/棕）+ 邊緣強度估計，挑出高分區塊當 targets ---
function buildScanTargetsFromImage(imgEl, opts = {}) {
  if (!imgEl) return [];

  const W = opts.w || 96;
  const H = opts.h || 96;
  const grid = opts.grid || 12; // 12x12 cells
  const pick = opts.pick || 16; // 選幾個點

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  // drawImage 會依比例塞進去（粗略即可）
  ctx.drawImage(imgEl, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // 先做灰階與簡易「edge」（用相鄰差值近似，不做完整 sobel 以省成本）
  const gray = new Float32Array(W * H);
  const edge = new Float32Array(W * H);
  const green = new Float32Array(W * H);
  const trunk = new Float32Array(W * H); // 粗略抓樹幹（偏棕/灰且飽和度不高）

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;

      // 灰階
      const gr = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      gray[y * W + x] = gr;

      // 綠色程度（簡單：g 相對於 r,b 的優勢）
      const gScore = clamp01((g - Math.max(r, b)) * 1.8 + 0.15);
      green[y * W + x] = gScore;

      // 樹幹程度（簡單：r、g、b 接近 + 飽和度低 + 亮度中低）
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx - mn;
      const trunkScore =
        clamp01((0.55 - gr) * 0.9 + 0.25) * clamp01((0.18 - sat) * 3.2 + 0.1);
      trunk[y * W + x] = trunkScore;
    }
  }

  // edge：用右/下鄰近像素差（近似梯度）
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const idx = y * W + x;
      const dx = Math.abs(gray[idx] - gray[idx + 1]);
      const dy = Math.abs(gray[idx] - gray[idx + W]);
      edge[idx] = clamp01((dx + dy) * 2.2);
    }
  }

  // 聚合到 grid cells
  const cell = [];
  const cellSizeX = W / grid;
  const cellSizeY = H / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let sumG = 0;
      let sumT = 0;
      let sumE = 0;
      let cnt = 0;
      const x0 = Math.floor(gx * cellSizeX);
      const x1 = Math.floor((gx + 1) * cellSizeX);
      const y0 = Math.floor(gy * cellSizeY);
      const y1 = Math.floor((gy + 1) * cellSizeY);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * W + x;
          sumG += green[idx];
          sumT += trunk[idx];
          sumE += edge[idx];
          cnt++;
        }
      }
      const gAvg = cnt ? sumG / cnt : 0;
      const tAvg = cnt ? sumT / cnt : 0;
      const eAvg = cnt ? sumE / cnt : 0;

      // 分數：綠/樹幹 + 邊緣，讓它更像「找物體輪廓」
      const score = gAvg * 0.55 + tAvg * 0.55 + eAvg * 0.65;

      cell.push({
        gx,
        gy,
        score,
        // cell 中心點（UV）
        x: (gx + 0.5) / grid,
        y: (gy + 0.5) / grid,
      });
    }
  }

  // 取 top cells
  cell.sort((a, b) => b.score - a.score);

  // 簡單 non-maximum suppression：避免點全部擠在一起
  const chosen = [];
  const minDist = 1.6 / grid; // UV 距離（越大越分散）
  for (let i = 0; i < cell.length && chosen.length < pick; i++) {
    const cand = cell[i];
    if (cand.score < 0.14) break; // 太低就不要了
    let ok = true;
    for (let j = 0; j < chosen.length; j++) {
      const dx = cand.x - chosen[j].x;
      const dy = cand.y - chosen[j].y;
      if (dx * dx + dy * dy < minDist * minDist) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(cand);
  }

  // 讓 targets 更偏「樹幹/垂直」：如果圖片中間分數不差，塞 1~2 個中線點
  const midX = 0.5;
  const midBoost = chosen.some((p) => Math.abs(p.x - midX) < 0.12);
  if (!midBoost) {
    // 找靠中線但分數高的
    const midCand = cell.filter((p) => Math.abs(p.x - midX) < 0.12).slice(0, 2);
    midCand.forEach((p) => chosen.push(p));
  }

  const out = chosen.slice(0, pick).map((p, k) => ({
    x: clamp01(p.x),
    y: clamp01(p.y),
    label: scanLabelPool[k % scanLabelPool.length],
    score: p.score,
  }));

  return out;
}

// 根據當前段數產生穩定的「偽隨機」索引，讓順序看起來亂，但每一段內是穩定的
function segmentRandomIndex(segment, max, salt = 0) {
  const n = segment + salt * 31.73;
  const x = Math.sin(n * 12.9898) * 43758.5453;
  const r = x - Math.floor(x); // 0~1
  return Math.floor(r * max);
}

// 依照「上傳的照片實際顯示的位置」換算到 canvas 座標，並再縮一圈
function getScanBounds(container, canvasW, canvasH, boxW, boxH) {
  // 若沒有 container，退回到畫面中間一塊區域
  if (!container) {
    const marginX = canvasW * 0.2;
    const marginY = canvasH * 0.2;
    return {
      xmin: marginX + boxW / 2,
      xmax: canvasW - marginX - boxW / 2,
      ymin: marginY + boxH / 2,
      ymax: canvasH - marginY - boxH / 2,
    };
  }

  // container 是 .fake-scan-canvas，它的祖先 photoPreview 裡面有 img
  const overlay = container.parentElement;
  const preview = overlay ? overlay.parentElement : null;
  const imgEl = preview ? preview.querySelector("img") : null;

  // 沒有 img 的時候一樣退回到畫面中間一塊區域
  if (!imgEl) {
    const marginX = canvasW * 0.2;
    const marginY = canvasH * 0.2;
    return {
      xmin: marginX + boxW / 2,
      xmax: canvasW - marginX - boxW / 2,
      ymin: marginY + boxH / 2,
      ymax: canvasH - marginY - boxH / 2,
    };
  }

  const overlayRect = container.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();

  // 若 overlay 尺寸異常，退回預設範圍
  if (!overlayRect.width || !overlayRect.height) {
    const marginX = canvasW * 0.2;
    const marginY = canvasH * 0.2;
    return {
      xmin: marginX + boxW / 2,
      xmax: canvasW - marginX - boxW / 2,
      ymin: marginY + boxH / 2,
      ymax: canvasH - marginY - boxH / 2,
    };
  }

  // 取「照片與 overlay 的交集」，避免照片部分超出 overlay 邊界的極端情況
  const imgLeft = Math.max(imgRect.left, overlayRect.left);
  const imgRight = Math.min(imgRect.right, overlayRect.right);
  const imgTop = Math.max(imgRect.top, overlayRect.top);
  const imgBottom = Math.min(imgRect.bottom, overlayRect.bottom);

  // 把 DOM 座標換成 canvas 座標（canvas 尺寸跟 container 一致）
  const left = ((imgLeft - overlayRect.left) / overlayRect.width) * canvasW;
  const right = ((imgRight - overlayRect.left) / overlayRect.width) * canvasW;
  const top = ((imgTop - overlayRect.top) / overlayRect.height) * canvasH;
  const bottom = ((imgBottom - overlayRect.top) / overlayRect.height) * canvasH;

  // 照片在 canvas 裡的寬高
  const imgWidthOnCanvas = right - left;
  const imgHeightOnCanvas = bottom - top;

  // 先預設縮一圈，避免貼邊
  let shrinkX = imgWidthOnCanvas * 0.12;
  let shrinkY = imgHeightOnCanvas * 0.12;

  // 確保「可以放得下至少 1.2 倍掃描匡」——避免超長／超扁照片時匡被擠出邊界
  const minInnerWidth = boxW * 1.2;
  const minInnerHeight = boxH * 1.2;

  if (imgWidthOnCanvas - 2 * shrinkX < minInnerWidth) {
    shrinkX = Math.max(0, (imgWidthOnCanvas - minInnerWidth) / 2);
  }
  if (imgHeightOnCanvas - 2 * shrinkY < minInnerHeight) {
    shrinkY = Math.max(0, (imgHeightOnCanvas - minInnerHeight) / 2);
  }

  // 最終允許「掃描框中心點」出現的範圍
  let xmin = left + shrinkX + boxW / 2;
  let xmax = right - shrinkX - boxW / 2;
  let ymin = top + shrinkY + boxH / 2;
  let ymax = bottom - shrinkY - boxH / 2;

  // 再做一次保險：如果因為某些極端比例導致範圍反向，就縮回照片中心
  if (xmin > xmax) {
    const cx = (left + right) / 2;
    xmin = xmax = cx;
  }
  if (ymin > ymax) {
    const cy = (top + bottom) / 2;
    ymin = ymax = cy;
  }

  return { xmin, xmax, ymin, ymax };
}

const markRootButton = document.getElementById("markRootButton");
const rootHeaveInput = document.getElementById("rootHeavePoint");
let isMarkingRoot = false;
let rootMarkerEl = null;

const openScanModeBtn = document.getElementById("openScanMode");
const cameraScanOverlay = document.getElementById("cameraScanOverlay");
const cameraPreview = document.getElementById("cameraPreview");
const closeScanModeBtn = document.getElementById("closeScanMode");
const captureScanPhotoBtn = document.getElementById("captureScanPhoto");
const cameraStage = document.querySelector(".camera-stage");

let cameraStream = null;
let fakeScanTimer = null;
let cameraVisionOverlayEl = null;
let cameraScanP5Instance = null;
let cameraLabelEls = [];

function ensureCameraVisionOverlay() {
  if (!cameraStage) return null;
  if (cameraVisionOverlayEl && cameraStage.contains(cameraVisionOverlayEl)) {
    return cameraVisionOverlayEl;
  }

  // 外層容器
  const wrap = document.createElement("div");
  wrap.className = "camera-vision-overlay";

  // 內層：沿用你 report 的 fake-scan-overlay 結構語言
  const overlay = document.createElement("div");
  overlay.className = "fake-scan-overlay active frozen";
  // 相機模式下：我們希望「一直停留」在畫面上（不做 5 秒消失）

  const grid = document.createElement("div");
  grid.className = "fake-scan-grid";

  const canvasContainer = document.createElement("div");
  canvasContainer.className = "fake-scan-canvas";

  const labelsWrap = document.createElement("div");
  labelsWrap.className = "fake-scan-labels";

  cameraLabelEls = [];
  const MAX = 5;
  for (let i = 0; i < MAX; i++) {
    const el = document.createElement("div");
    el.className = "fake-scan-label";
    el.style.opacity = "1";
    labelsWrap.appendChild(el);
    cameraLabelEls.push(el);
  }

  overlay.appendChild(grid);
  overlay.appendChild(canvasContainer);
  overlay.appendChild(labelsWrap);
  wrap.appendChild(overlay);
  cameraStage.appendChild(wrap);

  cameraVisionOverlayEl = wrap;

  // 初始化相機版 p5 掃描
  initCameraScanP5(canvasContainer);

  return cameraVisionOverlayEl;
}

function destroyCameraVisionOverlay() {
  if (cameraScanP5Instance && cameraScanP5Instance.remove) {
    cameraScanP5Instance.remove();
  }
  cameraScanP5Instance = null;
  cameraLabelEls = [];
  if (cameraVisionOverlayEl && cameraVisionOverlayEl.remove) {
    cameraVisionOverlayEl.remove();
  }
  cameraVisionOverlayEl = null;
}

function createCameraScanSketch(container) {
  // 相機版：直接以全畫面 canvas 為 scan bounds（避免跑出畫面）
  return function (p) {
    let canvasW = 0;
    let canvasH = 0;

    function resize() {
      const r = container.getBoundingClientRect();
      const w = r.width || window.innerWidth;
      const h = r.height || window.innerHeight;
      if (w === canvasW && h === canvasH) return;
      canvasW = w;
      canvasH = h;
      p.resizeCanvas(canvasW, canvasH);
    }

    p.setup = function () {
      const r = container.getBoundingClientRect();
      canvasW = r.width || window.innerWidth;
      canvasH = r.height || window.innerHeight;
      const c = p.createCanvas(canvasW, canvasH);
      c.parent(container);
      p.frameRate(30);
      p.rectMode(p.CENTER);
    };

    p.windowResized = function () {
      resize();
    };

    p.draw = function () {
      if (!container || !container.isConnected) {
        p.noLoop();
        return;
      }
      resize();
      p.clear();

      const seconds = p.millis() / 1000;
      const intervalSec = 0.08;
      const seg = Math.floor(seconds / intervalSec);

      const targets =
        typeof scanTargetsDynamic !== "undefined" &&
        scanTargetsDynamic?.length
          ? scanTargetsDynamic
          : typeof scanTargetsStatic !== "undefined" &&
            scanTargetsStatic?.length
            ? scanTargetsStatic
            : typeof scanTargets !== "undefined"
              ? scanTargets
              : [];

      const n = targets.length || 1;
      const newestId = segmentRandomIndex(seg, n, 0);

      const boxW = canvasW * 0.12; // 相機全螢幕：框略大一點更有存在感
      const boxH = canvasH * 0.22;

      const minX = boxW / 2;
      const maxX = canvasW - boxW / 2;
      const minY = boxH / 2;
      const maxY = canvasH - boxH / 2;

      const activeCount = 5;
      const positions = [];
      const metas = [];

      // 最新框
      const t0 = targets[newestId % n] || {
        x: 0.5,
        y: 0.5,
        label: "Feature hypothesis",
      };
      let cx = t0.x * canvasW;
      let cy = t0.y * canvasH;
      // 微抖（相機模式）
      cx +=
        (segmentRandomIndex(seg, 1000, 1.23) / 1000 - 0.5) *
        (canvasW * 0.02);
      cy +=
        (segmentRandomIndex(seg, 1000, 4.56) / 1000 - 0.5) *
        (canvasH * 0.02);
      cx = Math.min(Math.max(cx, minX), maxX);
      cy = Math.min(Math.max(cy, minY), maxY);
      positions.push({ x: cx, y: cy });
      metas.push({ text: t0.label || "Feature hypothesis", x: cx, y: cy });

      // 次框
      for (let i = 1; i < activeCount; i++) {
        const id = segmentRandomIndex(seg - i * 2, n, i * 17.37);
        const t = targets[id % n] || { x: 0.5, y: 0.5, label: `Feature ${i}` };
        let px = t.x * canvasW;
        let py = t.y * canvasH;
        px +=
          (segmentRandomIndex(seg, 1000, i * 3.7) / 1000 - 0.5) *
          (canvasW * 0.015);
        py +=
          (segmentRandomIndex(seg, 1000, i * 7.9) / 1000 - 0.5) *
          (canvasH * 0.015);
        px = Math.min(Math.max(px, minX), maxX);
        py = Math.min(Math.max(py, minY), maxY);
        positions.push({ x: px, y: py });
        metas.push({ text: t.label || `Feature ${i}`, x: px, y: py });
      }

      // 綠色疊圖（等大、直角）
      p.push();
      try {
        p.blendMode(p.SCREEN);
      } catch (e) {}
      p.noStroke();
      p.fill(180, 255, 43, 110);
      for (const pos of positions) p.rect(pos.x, pos.y, boxW, boxH);
      p.pop();

      // 白框
      p.noFill();
      p.stroke(255);
      p.strokeWeight(0.8);
      for (const pos of positions) p.rect(pos.x, pos.y, boxW, boxH);

      // 連線（折線）
      if (positions.length > 1) {
        p.strokeWeight(0.5);
        const newest = positions[0];
        for (let i = 1; i < positions.length; i++) {
          const tp = positions[i];
          const midX = (newest.x + tp.x) / 2;
          const midY = (newest.y + tp.y) / 2;
          const bendX =
            midX +
            (segmentRandomIndex(seg, 1000, i * 13.31) / 1000 - 0.5) *
              (canvasW * 0.02);
          const bendY =
            midY +
            (segmentRandomIndex(seg, 1000, i * 19.79) / 1000 - 0.5) *
              (canvasH * 0.02);
          p.line(newest.x, newest.y, bendX, bendY);
          p.line(bendX, bendY, tp.x, tp.y);
        }
      }

      // DOM 小字同步
      if (cameraLabelEls?.length) {
        for (let i = 0; i < cameraLabelEls.length; i++) {
          const el = cameraLabelEls[i];
          const m = metas[i];
          if (!m) {
            el.style.opacity = "0";
            continue;
          }
          el.style.opacity = "1";
          el.textContent = m.text;
          el.style.left = `${(m.x / canvasW) * 100}%`;
          el.style.top = `${(m.y / canvasH) * 100}%`;
        }
      }
    };
  };
}

function initCameraScanP5(container) {
  if (typeof window.p5 === "undefined") return;
  if (cameraScanP5Instance) return;
  cameraScanP5Instance = new p5(createCameraScanSketch(container));
}

const isMobileViewport = window.matchMedia("(max-width: 768px)").matches;

function initTreeIdFromQuery() {
  if (!treeIdInput) return;
  const params = new URLSearchParams(window.location.search);
  const treeId = params.get("treeId");
  if (treeId) {
    treeIdInput.value = treeId;
    treeIdInput.readOnly = true;
  }
}

function calculateRisk(problemType, targetType) {
  const highRiskTypes = ["嚴重傾斜", "主幹斷裂或裂縫", "根盤隆起或出土"];
  const mediumRiskTypes = ["大枝枯死", "樹冠壓到招牌或電線"];

  let level = "低風險";

  if (!problemType || problemType === "") {
    level = "未判定";
  } else if (highRiskTypes.includes(problemType)) {
    level = "高風險";
  } else if (mediumRiskTypes.includes(problemType)) {
    level = "中風險";
  }

  if (!targetType || level === "未判定") {
    return level;
  }

  const raise = () => {
    if (level === "低風險") return "中風險";
    if (level === "中風險") return "高風險";
    return level;
  };

  if (targetType === "A") {
    level = raise();
  } else if (targetType === "B" && level === "低風險") {
    level = "中風險";
  }

  return level;
}

function updateRiskDisplay() {
  const type = problemTypeSelect ? problemTypeSelect.value : "";
  const targetType = targetTypeSelect ? targetTypeSelect.value : "";
  const level = calculateRisk(type, targetType);

  if (!riskDisplay) return;

  riskDisplay.textContent = level === "未判定" ? "尚未判斷" : level;
  riskDisplay.className = "risk-display";

  if (level === "高風險") {
    riskDisplay.classList.add("risk-high");
  } else if (level === "中風險") {
    riskDisplay.classList.add("risk-medium");
  } else if (level === "低風險") {
    riskDisplay.classList.add("risk-low");
  }
}

function ensureFakeScanOverlay() {
  if (!photoPreview) return null;

  const stage = getPhotoStage();
  if (!stage) return null; // ✅ 沒有圖片就不建立 overlay

  if (fakeScanOverlayEl) {
    if (!stage.contains(fakeScanOverlayEl)) {
      stage.appendChild(fakeScanOverlayEl);
    }
    return fakeScanOverlayEl;
  }

  const overlay = document.createElement("div");
  overlay.className = "fake-scan-overlay";

  // 背景格線（保留原本的 CSS 效果）
  const grid = document.createElement("div");
  grid.className = "fake-scan-grid";

  // shader 畫布容器，p5 WebGL 會掛在這裡
  const canvasContainer = document.createElement("div");
  canvasContainer.className = "fake-scan-canvas";

  // 中央文字
  const text = document.createElement("div");
  text.className = "fake-scan-text";
  text.textContent = "SCANNING";

  // 小字 label：顯示英文學名 / 狀態
  // ✅ 多個小字：每個框一個（更像 machine vision debug snapshot）
  const labelsWrap = document.createElement("div");
  labelsWrap.className = "fake-scan-labels";
  scanLabelsWrapEl = labelsWrap;

  // 保留舊的單一 label 參考（相容），但實際用多 label
  const label = document.createElement("div");
  label.className = "fake-scan-label";
  label.textContent = "";
  scanLabelEl = label;

  scanLabelEls = [];
  const MAX_LABELS = 5; // 對齊目前 activeCount
  for (let i = 0; i < MAX_LABELS; i++) {
    const el = document.createElement("div");
    el.className = "fake-scan-label";
    el.textContent = "";
    labelsWrap.appendChild(el);
    scanLabelEls.push(el);
  }

  overlay.appendChild(grid);
  overlay.appendChild(canvasContainer);
  overlay.appendChild(text);
  overlay.appendChild(labelsWrap);

  // ✅ overlay 只貼在圖片 stage 上（避免跑到白邊）
  stage.appendChild(overlay);
  fakeScanOverlayEl = overlay;

  // 初始化 p5 掃描動畫
  initScanP5(canvasContainer);

  return overlay;
}

function updateScanLabel(idx) {
  // 兼容：保留舊 API（但主要用多 label，在 drawOverlay 裡更新）
  const targets =
    scanTargetsDynamic && scanTargetsDynamic.length
      ? scanTargetsDynamic
      : scanTargetsStatic;
  if (!scanLabelEl || !fakeScanOverlayEl || !targets.length) return;
  const target = targets[idx % targets.length];
  scanLabelEl.textContent = target.label;
  scanLabelEl.style.left = `${target.x * 100}%`;
  scanLabelEl.style.top = `${target.y * 100}%`;
}

function createScanSketch(container) {
  return function (p) {
    let canvasW = 0;
    let canvasH = 0;
    let frozen = false;

    // 行為模型（search -> align -> lock）
    let cur = { x: 0.5, y: 0.5 }; // 目前中心（UV）
    let goal = { x: 0.5, y: 0.5 }; // 目標中心（UV）
    let lockStrength = 0; // 0~1，越高抖越小、越黏

    // 畫面殘留（最後 freeze 的結果）
    let frozenFrame = null; // { positions:[], labelIdx:number, seg:number }
    let lastPositions = [];
    let lastMetas = []; // [{text, x, y}]
    let lastBounds = null; // {xmin,xmax,ymin,ymax} for clamping labels

    function resizeCanvasToContainer() {
      const rect = container.getBoundingClientRect();
      const w = rect.width || 300;
      const h = rect.height || 400;
      if (w === canvasW && h === canvasH) return;
      canvasW = w;
      canvasH = h;
      p.resizeCanvas(canvasW, canvasH);
    }

    p.setup = function () {
      const rect = container.getBoundingClientRect();
      canvasW = rect.width || 300;
      canvasH = rect.height || 400;

      const c = p.createCanvas(canvasW, canvasH);
      c.parent(container);

      p.noFill();
      p.stroke(255);
      p.strokeWeight(2); // 2px 左右的線寬
      p.frameRate(30);

      // 對外暴露控制：freeze/resume/updateTargets
      p.__us = {
        freeze() {
          frozen = true;
          frozenFrame = {
            positions: lastPositions ? [...lastPositions] : [],
            metas: lastMetas ? [...lastMetas] : [],
          };
        },
        resume() {
          frozen = false;
          frozenFrame = null;
          lockStrength = 0;
        },
      };
    };

    p.windowResized = function () {
      resizeCanvasToContainer();
    };

    p.draw = function () {
      if (!container || !container.isConnected) {
        // overlay 被移除就停止
        p.noLoop();
        return;
      }

      resizeCanvasToContainer();
      p.clear(); // 透明疊在照片上

      // frozen：停在最後一幀（保留框線/連線/小字位置）
      if (frozen && frozenFrame) {
        // ⛔ freeze 後：只畫 frozenFrame，完全不更新任何狀態
        drawOverlay(
          frozenFrame.positions || [],
          frozenFrame.metas || [],
          /*strong=*/ true
        );
        return;
      }

      const seconds = p.millis() / 1000.0;

      // 每 0.08 秒換一組
      const intervalSec = 0.08;
      const seg = Math.floor(seconds / intervalSec);

      const targets =
        scanTargetsDynamic && scanTargetsDynamic.length
          ? scanTargetsDynamic
          : scanTargetsStatic;
      const n = targets.length;
      if (!n) return;

      const newestId = segmentRandomIndex(seg, n, 0);
      updateScanLabel(newestId);

      // 直立長方形
      const boxW = canvasW * 0.08;
      const boxH = canvasH * 0.18;

      // ★ 依照「照片實際位置」算出可掃描範圍（已經有內縮一圈）
      const { xmin, xmax, ymin, ymax } = getScanBounds(
        container,
        canvasW,
        canvasH,
        boxW,
        boxH
      );
      lastBounds = { xmin, xmax, ymin, ymax };

      // --- 行為：search -> align（抖）-> lock（抖變小、更黏） ---
      // 每隔一段，更新目標點；但移動是「平滑靠近」
      const target = targets[newestId];
      goal.x = target.x;
      goal.y = target.y;

      // 平滑靠近（越接近越慢）
      const ease = 0.12;
      cur.x = cur.x + (goal.x - cur.x) * ease;
      cur.y = cur.y + (goal.y - cur.y) * ease;

      // 根據距離估計「信心」：越近越像鎖定
      const dx = goal.x - cur.x;
      const dy = goal.y - cur.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const conf = clamp01(1.0 - dist * 6.5); // dist 小 -> conf 高
      lockStrength = lockStrength * 0.86 + conf * 0.14;

      // jitter：在 lockStrength 低時較大，且會有微幅「抓不準」感
      const jitterAmp = (1 - lockStrength) * 0.035; // UV
      const jitterX =
        (segmentRandomIndex(seg, 1000, 3.71) / 1000 - 0.5) * jitterAmp;
      const jitterY =
        (segmentRandomIndex(seg, 1000, 7.19) / 1000 - 0.5) * jitterAmp;

      // 主框（最新）中心點（canvas px）
      let cx = (cur.x + jitterX) * canvasW;
      let cy = (cur.y + jitterY) * canvasH;
      // ✅ clamp：確保「整個框」都在照片內
      const minX = xmin + boxW / 2;
      const maxX = xmax - boxW / 2;
      const minY = ymin + boxH / 2;
      const maxY = ymax - boxH / 2;
      cx = Math.min(Math.max(cx, minX), maxX);
      cy = Math.min(Math.max(cy, minY), maxY);

      // 其餘框：從「同一張圖的其他高分點」抽樣，但也帶少量不確定性
      const activeCount = 5;
      const positions = [];
      const metas = [];
      positions.push({ x: cx, y: cy });
      metas.push({
        text: targets[newestId]?.label || "Feature hypothesis",
        x: cx,
        y: cy,
      });

      for (let i = 1; i < activeCount; i++) {
        const id = segmentRandomIndex(seg - i * 2, n, i * 17.37);
        const t = targets[id];
        let px = t.x * canvasW;
        let py = t.y * canvasH;

        // 次要框 jitter 小一點，但還是有
        const j2 =
          (segmentRandomIndex(seg, 1000, i * 9.13) / 1000 - 0.5) *
          (canvasW * 0.018);
        const j3 =
          (segmentRandomIndex(seg, 1000, i * 11.47) / 1000 - 0.5) *
          (canvasH * 0.018);
        px += j2;
        py += j3;

        // ✅ 次框同樣使用「含尺寸」的 clamp
        px = Math.min(Math.max(px, minX), maxX);
        py = Math.min(Math.max(py, minY), maxY);
        positions.push({ x: px, y: py });
        metas.push({
          text: t?.label || `Feature ${i}`,
          x: px,
          y: py,
        });
      }

      // 只有在「未 freeze」時才更新 last 狀態
      lastPositions = positions;
      lastMetas = metas;
      drawOverlay(positions, metas, /*strong=*/ false, seg, canvasW, canvasH);
    };

    function drawOverlay(
      positions,
      metas = [],
      strong = false,
      seg = 0,
      w = canvasW,
      h = canvasH
    ) {
      if (!positions || !positions.length) return;

      p.stroke(255);
      p.strokeWeight(strong ? 0.9 : 0.7);
      p.rectMode(p.CENTER);

      const boxW = w * 0.08;
      const boxH = h * 0.18;

      // ✅ 先畫「疊圖掃描高亮」
      // 綠色 screen / add，大小與白色匡完全一致、無圓角
      p.push();
      try {
        p.blendMode(p.SCREEN);
      } catch (e) {}
      p.noStroke();
      // 透明度：掃描中較亮，freeze 稍降但仍清楚
      const a = strong ? 80 : 110;
      // Urban Seed 綠色（segmentation mask 感）
      p.fill(180, 255, 43, a); // #b4ff2b
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        // ✅ 與白色匡「完全同尺寸、無圓角」
        p.rect(pos.x, pos.y, boxW, boxH);
      }
      p.pop();

      // 框
      p.noFill();
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        p.rect(pos.x, pos.y, boxW, boxH);
      }

      // 連線：從最新框連到其他框，折線略帶不確定
      if (positions.length > 1) {
        p.strokeWeight(strong ? 0.7 : 0.5);
        const newest = positions[0];
        for (let i = 1; i < positions.length; i++) {
          const targetPos = positions[i];
          const midX = (newest.x + targetPos.x) / 2;
          const midY = (newest.y + targetPos.y) / 2;
          const bendX =
            midX +
            (segmentRandomIndex(seg, 1000, i * 13.31) / 1000 - 0.5) *
              (w * (strong ? 0.012 : 0.02));
          const bendY =
            midY +
            (segmentRandomIndex(seg, 1000, i * 19.79) / 1000 - 0.5) *
              (h * (strong ? 0.012 : 0.02));
          p.line(newest.x, newest.y, bendX, bendY);
          p.line(bendX, bendY, targetPos.x, targetPos.y);
        }
      }

      // ✅ 更新 DOM 小字位置：每個框一個，並且 clamp 在照片內
      syncDomLabels(metas, w, h);
    }

    function syncDomLabels(metas, w, h) {
      if (!scanLabelEls || !scanLabelEls.length) return;
      if (!fakeScanOverlayEl) return;

      const bounds = lastBounds;
      for (let i = 0; i < scanLabelEls.length; i++) {
        const el = scanLabelEls[i];
        const m = metas[i];
        if (!m) {
          el.style.opacity = "0";
          continue;
        }
        el.textContent = m.text || "";

        // px -> %（以 overlay 為參考）
        let x = m.x;
        let y = m.y;

        // clamp：確保小字不要跑到圖片外（用同一組 xmin/xmax/ymin/ymax）
        if (bounds) {
          x = Math.min(Math.max(x, bounds.xmin), bounds.xmax);
          y = Math.min(Math.max(y, bounds.ymin), bounds.ymax);
        }

        el.style.left = `${(x / w) * 100}%`;
        el.style.top = `${(y / h) * 100}%`;
        el.style.opacity = "1";
      }
    }
  };
}

function initScanP5(container) {
  if (typeof window.p5 === "undefined") {
    console.warn("p5.js not loaded; skip scan animation");
    return;
  }
  if (scanP5Instance) return;
  scanP5Instance = new p5(createScanSketch(container));
}

function startScanAnimation() {
  if (!scanP5Instance) return;
  if (scanP5Instance.loop) {
    scanP5Instance.loop();
  }
}

function stopScanAnimation() {
  if (!scanP5Instance) return;
  if (scanP5Instance.noLoop) {
    scanP5Instance.noLoop();
  }
}

function setDynamicTargetsFromPreviewImage() {
  if (!photoPreview) return;
  const imgEl = photoPreview.querySelector("img");
  if (!imgEl) return;
  try {
    const dyn = buildScanTargetsFromImage(imgEl, {
      w: 96,
      h: 96,
      grid: 12,
      pick: 16,
    });
    scanTargetsDynamic = Array.isArray(dyn) ? dyn : [];
  } catch (e) {
    console.warn("buildScanTargetsFromImage failed", e);
    scanTargetsDynamic = [];
  }
}

function startFakeScan(source) {
  if (!photoPreview || !photoPreview.querySelector("img")) return;

  // 若已在掃描中，就不要再啟動一次
  if (isFakeScanning) return;
  isFakeScanning = true;

  const overlay = ensureFakeScanOverlay();
  if (!overlay) {
    isFakeScanning = false;
    return;
  }

  // 每次掃描開始：重新根據照片做 targets（顏色/邊緣）
  setDynamicTargetsFromPreviewImage();

  overlay.classList.add("active");
  overlay.classList.remove("frozen");
  // ✅ 開始掃描：多 label 打開
  if (scanLabelEls && scanLabelEls.length) {
    scanLabelEls.forEach((el) => (el.style.opacity = "1"));
  }

  // p5 恢復動態
  if (scanP5Instance && scanP5Instance.__us && scanP5Instance.__us.resume) {
    scanP5Instance.__us.resume();
  }
  startScanAnimation();

  if (fakeScanTimer) {
    clearTimeout(fakeScanTimer);
  }

  if (fakeScanStatus) {
    fakeScanStatus.textContent = "系統偵測中...";
  }

  if (problemTypeSelect) {
    problemTypeSelect.value = "根盤隆起或出土";
    updateRiskDisplay();
  }

  fakeScanTimer = setTimeout(() => {
    // ✅ 不要消失：freeze 成「報告結果」留在畫面上
    overlay.classList.add("frozen");
    // ✅ freeze：小字持續顯示
    if (scanLabelEls && scanLabelEls.length) {
      scanLabelEls.forEach((el) => (el.style.opacity = "1"));
    }

    if (scanP5Instance && scanP5Instance.__us && scanP5Instance.__us.freeze) {
      scanP5Instance.__us.freeze();
    }
    stopScanAnimation();

    if (fakeScanStatus) {
      fakeScanStatus.textContent =
        source === "camera"
          ? "偵測完成：已擷取街樹影像，請確認問題位置與類型。"
          : "偵測完成：已分析上傳影像，請確認問題類型。";
    }
    isFakeScanning = false;
  }, 2500);
}

function setPhotoDropzoneVisibility(hasImage) {
  if (!photoDropzone) return;
  if (hasImage) {
    photoDropzone.style.display = "none";
  } else {
    photoDropzone.style.display = "";
  }
}

if (photoDropzone && photoInput) {
  photoDropzone.addEventListener("click", () => {
    photoInput.click();
  });
}

function attachRootMarking(img) {
  if (!img) return;
  img.addEventListener("click", (event) => {
    if (!isMarkingRoot) return;

    const rect = img.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const xRatio = x / rect.width;
    const yRatio = y / rect.height;

    const xPercent = xRatio * 100;
    const yPercent = yRatio * 100;

    createOrMoveRootMarker(photoPreview, xPercent, yPercent);

    if (rootHeaveInput) {
      rootHeaveInput.value = `x:${xRatio.toFixed(4)},y:${yRatio.toFixed(4)}`;
    }
  });
}

if (photoInput && photoPreview) {
  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    if (!file) {
      photoPreview.innerHTML = "";
      rootMarkerEl = null;
      if (rootHeaveInput) rootHeaveInput.value = "";
      if (fakeScanTimer) {
        clearTimeout(fakeScanTimer);
        fakeScanTimer = null;
      }
      if (fakeScanOverlayEl) {
        fakeScanOverlayEl.classList.remove("active");
      }
      if (fakeScanStatus) {
        fakeScanStatus.textContent = "";
      }
      isFakeScanning = false;
      setPhotoDropzoneVisibility(false);
      return;
    }

    setPhotoDropzoneVisibility(true);

    const img = document.createElement("img");
    img.id = "photoPreviewImg";
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);

    mountPhotoToStage(img);
    rootMarkerEl = null;
    if (rootHeaveInput) rootHeaveInput.value = "";

    attachRootMarking(img);

    // 不論桌機或手機，只要有上傳照片就啟動 fakeScan("upload")
    setTimeout(() => {
      startFakeScan("upload");
    }, 300);
  });
}

function createOrMoveRootMarker(container, xPercent, yPercent) {
  const stage = getPhotoStage();
  const host = stage || container;
  if (!host) return;

  if (!rootMarkerEl || !host.contains(rootMarkerEl)) {
    rootMarkerEl = document.createElement("div");
    rootMarkerEl.className = "root-marker";
    host.appendChild(rootMarkerEl);
  }

  rootMarkerEl.style.left = xPercent + "%";
  rootMarkerEl.style.top = yPercent + "%";
}

if (markRootButton) {
  markRootButton.addEventListener("click", () => {
    if (!photoPreview || !photoPreview.querySelector("img")) {
      alert("請先上傳或拍攝一張照片，再標記凸起位置。");
      return;
    }
    isMarkingRoot = !isMarkingRoot;
    if (isMarkingRoot) {
      markRootButton.textContent = "點擊照片標記凸起（再次點擊可重新選擇）";
      markRootButton.classList.add("active");
    } else {
      markRootButton.textContent = "開始標記樹根凸起";
      markRootButton.classList.remove("active");
    }
  });
}

async function openScanMode() {
  if (!cameraScanOverlay || !cameraPreview) return;

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    cameraPreview.srcObject = cameraStream;
    cameraScanOverlay.classList.add("visible");
    cameraScanOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");

    // ✅ 顯示相機版 machine-vision overlay（與 report 同語言）
    ensureCameraVisionOverlay();
  } catch (err) {
    console.error("openScanMode error", err);
    alert("無法開啟相機，請確認瀏覽器權限或改用一般上傳。");
  }
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

function closeScanMode() {
  if (!cameraScanOverlay) return;
  stopCameraStream();
  cameraScanOverlay.classList.remove("visible");
  cameraScanOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");

  // ✅ 關閉時移除相機 overlay，避免殘留
  destroyCameraVisionOverlay();
}

if (openScanModeBtn) {
  openScanModeBtn.addEventListener("click", openScanMode);
}
if (closeScanModeBtn) {
  closeScanModeBtn.addEventListener("click", closeScanMode);
}
if (cameraScanOverlay) {
  cameraScanOverlay.addEventListener("click", (e) => {
    if (e.target === cameraScanOverlay) {
      closeScanMode();
    }
  });
}

async function captureScanPhoto() {
  if (!cameraPreview || !photoPreview || !photoInput) return;
  if (!cameraStream) {
    alert("相機尚未啟動。");
    return;
  }

  const video = cameraPreview;
  const canvas = document.createElement("canvas");
  const width = video.videoWidth || 1080;
  const height = video.videoHeight || 1440;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(
    (blob) => {
      if (!blob) return;

      // 把相機影像顯示在 photoPreview 裡
      const imgUrl = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.id = "photoPreviewImg";
      img.src = imgUrl;
      img.onload = () => URL.revokeObjectURL(imgUrl);

      mountPhotoToStage(img);
      rootMarkerEl = null;
      if (rootHeaveInput) rootHeaveInput.value = "";

      // 建一個檔案塞回 <input type="file">，讓表單送出時還是有檔案
      const file = new File([blob], "scan-photo.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(file);
      photoInput.files = dt.files;

      attachRootMarking(img);
      setPhotoDropzoneVisibility(true);

      // 關閉相機掃描 overlay，順便停掉 cameraStream
      closeScanMode();

      // 不論桌機 / 手機，開啟相機掃描 → 拍照後都啟動同一套 fakeScan("camera")
      setTimeout(() => {
        startFakeScan("camera");
      }, 300);
    },
    "image/jpeg",
    0.9
  );
}

if (captureScanPhotoBtn) {
  captureScanPhotoBtn.addEventListener("click", captureScanPhoto);
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

  function toggleSearch() {
    body.classList.toggle("us-mobile-search-open");
    if (body.classList.contains("us-mobile-search-open") && searchInput) {
      searchInput.focus();
    }
  }

  if (searchToggle) {
    searchToggle.addEventListener("click", toggleSearch);
  }

  if (searchSubmit) {
    searchSubmit.addEventListener("click", (event) => {
      event.preventDefault();
      toggleSearch();
    });
  }

  function closeMenu() {
    body.classList.remove("us-mobile-menu-open");
  }

  if (menuToggle && navOverlay) {
    menuToggle.addEventListener("click", () => {
      body.classList.add("us-mobile-menu-open");
    });

    navOverlay.addEventListener("click", (event) => {
      if (event.target === navOverlay) {
        closeMenu();
      }
    });
  }

  if (navClose) {
    navClose.addEventListener("click", closeMenu);
  }

  if (navPanel) {
    navPanel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }
}

if (problemTypeSelect) {
  problemTypeSelect.addEventListener("change", updateRiskDisplay);
}
if (targetTypeSelect) {
  targetTypeSelect.addEventListener("change", updateRiskDisplay);
}

if (reportForm) {
  reportForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (formMessage) {
      formMessage.textContent = "";
      formMessage.classList.remove("success", "error");
    }

    const file = photoInput && photoInput.files[0];
    if (!file) {
      if (formMessage) {
        formMessage.textContent = "請先上傳或拍攝一張照片。";
        formMessage.classList.add("error");
      }
      return;
    }

    const treeId = treeIdInput ? treeIdInput.value.trim() : "";
    const location = document.getElementById("location").value.trim();
    const problemType = problemTypeSelect ? problemTypeSelect.value : "";
    const targetType = targetTypeSelect ? targetTypeSelect.value : "";
    const description = document.getElementById("description").value.trim();
    const contact = contactInput ? contactInput.value.trim() : "";
    const rootHeavePoint = rootHeaveInput ? rootHeaveInput.value.trim() : "";

    const riskLevel = calculateRisk(problemType, targetType);

    const formData = new FormData();
    formData.append("photo", file);
    formData.append("treeId", treeId);
    formData.append("location", location);
    formData.append("problemType", problemType);
    formData.append("targetType", targetType);
    formData.append("description", description);
    formData.append("contact", contact);
    formData.append("riskLevel", riskLevel);
    formData.append("rootHeavePoint", rootHeavePoint);

    try {
      // ✅ Prototype：先不處理送出的資料，只做「看起來真的送出」
      if (formMessage) {
        formMessage.textContent = "送出成功！正在返回首頁…";
        formMessage.classList.add("success");
      }

      showSubmitModalAndGoHome();

      reportForm.reset();
      if (photoPreview) {
        photoPreview.innerHTML = "";
      }
      if (riskDisplay) {
        riskDisplay.textContent = "尚未判斷";
        riskDisplay.className = "risk-display";
      }
      if (rootHeaveInput) rootHeaveInput.value = "";
      rootMarkerEl = null;
      if (fakeScanTimer) {
        clearTimeout(fakeScanTimer);
        fakeScanTimer = null;
      }
      if (fakeScanOverlayEl) {
        fakeScanOverlayEl.classList.remove("active");
      }
      if (fakeScanStatus) {
        fakeScanStatus.textContent = "";
      }
      isFakeScanning = false;

    } catch (err) {
      console.error(err);
      if (formMessage) {
        formMessage.textContent = "系統暫時無法送出，請稍後再試。";
        formMessage.classList.add("error");
      }
    }
  });
}

if (typeof initTreeIdFromQuery === "function") {
  initTreeIdFromQuery();
}
if (typeof updateRiskDisplay === "function") {
  updateRiskDisplay();
}
if (typeof initMobileHeader === "function") {
  initMobileHeader();
}
setPhotoDropzoneVisibility(false);

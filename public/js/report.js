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
const photoDropzone = document.getElementById("photoDropzone");

// 掃描框會跳到的各個位置（UV 座標 0~1） + 對應文字
const scanTargets = [
  { x: 0.20, y: 0.86, label: "Root flare / heaving" },
  { x: 0.50, y: 0.84, label: "Soil surface check" },
  { x: 0.80, y: 0.82, label: "Pavement / root conflict" },

  { x: 0.18, y: 0.64, label: "Lower trunk decay" },
  { x: 0.50, y: 0.60, label: "Mid trunk stability" },
  { x: 0.82, y: 0.62, label: "Lower crown stress" },

  { x: 0.22, y: 0.42, label: "Branch attachment" },
  { x: 0.50, y: 0.40, label: "Crown symmetry" },
  { x: 0.78, y: 0.38, label: "Lateral branch check" },

  { x: 0.26, y: 0.22, label: "Canopy density" },
  { x: 0.50, y: 0.20, label: "Leader vitality" },
  { x: 0.74, y: 0.18, label: "Upper crown defects" },
];

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
  const left =
    ((imgLeft - overlayRect.left) / overlayRect.width) * canvasW;
  const right =
    ((imgRight - overlayRect.left) / overlayRect.width) * canvasW;
  const top =
    ((imgTop - overlayRect.top) / overlayRect.height) * canvasH;
  const bottom =
    ((imgBottom - overlayRect.top) / overlayRect.height) * canvasH;

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

let cameraStream = null;
let fakeScanTimer = null;

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

  if (fakeScanOverlayEl) {
    if (!photoPreview.contains(fakeScanOverlayEl)) {
      photoPreview.appendChild(fakeScanOverlayEl);
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
  const label = document.createElement("div");
  label.className = "fake-scan-label";
  label.textContent = "";
  scanLabelEl = label;

  overlay.appendChild(grid);
  overlay.appendChild(canvasContainer);
  overlay.appendChild(text);
  overlay.appendChild(label);

  photoPreview.appendChild(overlay);
  fakeScanOverlayEl = overlay;

  // 初始化 p5 掃描動畫
  initScanP5(canvasContainer);

  return overlay;
}

function updateScanLabel(idx) {
  if (!scanLabelEl || !fakeScanOverlayEl || !scanTargets.length) return;
  const target = scanTargets[idx % scanTargets.length];
  scanLabelEl.textContent = target.label;
  scanLabelEl.style.left = `${target.x * 100}%`;
  scanLabelEl.style.top = `${target.y * 100}%`;
}

function createScanSketch(container) {
  return function (p) {
    let canvasW = 0;
    let canvasH = 0;

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

      const seconds = p.millis() / 1000.0;

      // 每 0.08 秒換一組
      const intervalSec = 0.08;
      const seg = Math.floor(seconds / intervalSec);

      const n = scanTargets.length;
      if (!n) return;

      const newestId = segmentRandomIndex(seg, n, 0);
      updateScanLabel(newestId);

      // 直立長方形
      const boxW = canvasW * 0.08;
      const boxH = canvasH * 0.18;

      p.stroke(255);
      p.strokeWeight(0.7);
      p.rectMode(p.CENTER);

      const activeCount = 4;
      const positions = [];

      // ★ 依照「照片實際位置」算出可掃描範圍（已經有內縮一圈）
      const { xmin, xmax, ymin, ymax } = getScanBounds(
        container,
        canvasW,
        canvasH,
        boxW,
        boxH
      );

      for (let i = 0; i < activeCount; i++) {
        const id =
          i === 0
            ? newestId
            : segmentRandomIndex(seg - i, n, i * 17.37);

        const target = scanTargets[id];

        // UV → 大致中心點
        let cx = target.x * canvasW;
        let cy = target.y * canvasH;

        // 輕微 jitter（增加亂碼感）
        const jx =
          (segmentRandomIndex(seg, 1000, i * 5.21) / 1000 - 0.5) *
          (canvasW * 0.03);
        const jy =
          (segmentRandomIndex(seg, 1000, i * 9.87) / 1000 - 0.5) *
          (canvasH * 0.03);

        cx += jx;
        cy += jy;

        // ★ 把位置 clamp 在「照片紅框內縮範圍」裡
        cx = Math.min(Math.max(cx, xmin), xmax);
        cy = Math.min(Math.max(cy, ymin), ymax);

        positions.push({ x: cx, y: cy });
        p.rect(cx, cy, boxW, boxH);
      }

      // 連線：保持原本亂碼感
      if (positions.length > 1) {
        p.stroke(255);
        p.strokeWeight(0.5);

        const newest = positions[0];

        for (let i = 1; i < positions.length; i++) {
          const targetPos = positions[i];

          const midX = (newest.x + targetPos.x) / 2;
          const midY = (newest.y + targetPos.y) / 2;

          const bendX =
            midX +
            (segmentRandomIndex(seg, 1000, i * 13.31) / 1000 - 0.5) *
              (canvasW * 0.02);
          const bendY =
            midY +
            (segmentRandomIndex(seg, 1000, i * 19.79) / 1000 - 0.5) *
              (canvasH * 0.02);

          p.line(newest.x, newest.y, bendX, bendY);
          p.line(bendX, bendY, targetPos.x, targetPos.y);
        }
      }
    };
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

  overlay.classList.add("active");
  if (scanLabelEl) {
    scanLabelEl.style.opacity = "1";
  }

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
    overlay.classList.remove("active");
    if (scanLabelEl) {
      scanLabelEl.style.opacity = "0";
    }
    if (fakeScanStatus) {
      fakeScanStatus.textContent =
        source === "camera"
          ? "偵測完成：已擷取街樹影像，請確認問題位置與類型。"
          : "偵測完成：已分析上傳影像，請確認問題類型。";
    }
    isFakeScanning = false;
  }, 5000);
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

    photoPreview.innerHTML = "";
    rootMarkerEl = null;
    if (rootHeaveInput) rootHeaveInput.value = "";
    photoPreview.appendChild(img);

    attachRootMarking(img);

    // 不論桌機或手機，只要有上傳照片就啟動 fakeScan("upload")
    setTimeout(() => {
      startFakeScan("upload");
    }, 300);
  });
}

function createOrMoveRootMarker(container, xPercent, yPercent) {
  if (!container) return;

  if (!rootMarkerEl || !container.contains(rootMarkerEl)) {
    rootMarkerEl = document.createElement("div");
    rootMarkerEl.className = "root-marker";
    container.appendChild(rootMarkerEl);
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

      photoPreview.innerHTML = "";
      rootMarkerEl = null;
      if (rootHeaveInput) rootHeaveInput.value = "";
      photoPreview.appendChild(img);

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
      const res = await fetch("/api/report", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("回報送出失敗");
      }

      if (formMessage) {
        formMessage.textContent = "已收到回報，感謝你的通知！";
        formMessage.classList.add("success");
      }

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

      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
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

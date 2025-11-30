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
const photoDropzone = document.getElementById("photoDropzone");

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

  const grid = document.createElement("div");
  grid.className = "fake-scan-grid";

  const line = document.createElement("div");
  line.className = "fake-scan-line";

  const text = document.createElement("div");
  text.className = "fake-scan-text";
  text.textContent = "SCANNING";

  overlay.appendChild(grid);
  overlay.appendChild(line);
  overlay.appendChild(text);

  photoPreview.appendChild(overlay);
  fakeScanOverlayEl = overlay;
  return overlay;
}

function startFakeScan(source) {
  if (!photoPreview || !photoPreview.querySelector("img")) return;

  const overlay = ensureFakeScanOverlay();
  if (!overlay) return;

  overlay.classList.add("active");

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
    if (fakeScanStatus) {
      fakeScanStatus.textContent =
        source === "camera"
          ? "偵測完成：已擷取街樹影像，請確認問題位置與類型。"
          : "偵測完成：已分析上傳影像，請確認問題類型。";
    }
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

    if (!isMobileViewport) {
      setTimeout(() => {
        startFakeScan("upload");
      }, 300);
    }
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

      const imgUrl = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.id = "photoPreviewImg";
      img.src = imgUrl;
      img.onload = () => URL.revokeObjectURL(imgUrl);

      photoPreview.innerHTML = "";
      rootMarkerEl = null;
      if (rootHeaveInput) rootHeaveInput.value = "";
      photoPreview.appendChild(img);

      // 建立一個檔案塞回 input
      const file = new File([blob], "scan-photo.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(file);
      photoInput.files = dt.files;

      attachRootMarking(img);
      setPhotoDropzoneVisibility(true);

      closeScanMode();

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

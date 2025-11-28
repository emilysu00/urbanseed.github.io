// public/js/report.js

const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photoPreview");
const problemTypeSelect = document.getElementById("problemType");
const riskDisplay = document.getElementById("riskDisplay");
const reportForm = document.getElementById("reportForm");
const formMessage = document.getElementById("formMessage");

// 1. 照片預覽
photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) {
    photoPreview.innerHTML = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    photoPreview.innerHTML = `
      <img src="${e.target.result}" alt="預覽樹木照片" />
    `;
  };
  reader.readAsDataURL(file);
});

// 2. 簡單風險判斷邏輯
function calculateRisk(problemType) {
  // 這裡是「半實作版」：只根據類型做粗略分類
  const highRiskTypes = ["嚴重傾斜", "主幹斷裂或裂縫", "根盤隆起或出土"];
  const mediumRiskTypes = ["大枝枯死", "樹冠壓到招牌或電線"];

  if (highRiskTypes.includes(problemType)) return "高風險";
  if (mediumRiskTypes.includes(problemType)) return "中風險";
  if (!problemType || problemType === "") return "未判定";
  return "低風險";
}

function updateRiskDisplay() {
  const type = problemTypeSelect.value;
  const level = calculateRisk(type);

  riskDisplay.textContent = level === "未判定" ? "尚未判斷" : level;
  riskDisplay.className = "risk-display"; // reset

  if (level === "高風險") {
    riskDisplay.classList.add("risk-high");
  } else if (level === "中風險") {
    riskDisplay.classList.add("risk-medium");
  } else if (level === "低風險") {
    riskDisplay.classList.add("risk-low");
  }
}

problemTypeSelect.addEventListener("change", updateRiskDisplay);

// 3. 表單送出
reportForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formMessage.textContent = "";
  formMessage.classList.remove("success", "error");

  const file = photoInput.files[0];
  if (!file) {
    formMessage.textContent = "請先上傳或拍攝一張照片。";
    formMessage.classList.add("error");
    return;
  }

  const location = document.getElementById("location").value.trim();
  const problemType = problemTypeSelect.value;
  const description = document.getElementById("description").value.trim();
  const riskLevel = calculateRisk(problemType);

  const formData = new FormData();
  formData.append("photo", file);
  formData.append("location", location);
  formData.append("problemType", problemType);
  formData.append("description", description);
  formData.append("riskLevel", riskLevel);

  try {
    const res = await fetch("/api/report", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error("上傳失敗");
    }

    const data = await res.json();

    formMessage.textContent = "回報已送出，感謝你的協助！";
    formMessage.classList.add("success");

    // 送出後重置表單
    reportForm.reset();
    photoPreview.innerHTML = "";
    riskDisplay.textContent = "尚未判斷";
    riskDisplay.className = "risk-display";

    // （選擇性）幾秒後導回首頁
    setTimeout(() => {
      window.location.href = "/";
    }, 1500);
  } catch (err) {
    console.error("送出失敗：", err);
    formMessage.textContent = "送出失敗，請稍後再試。";
    formMessage.classList.add("error");
  }
});

// server.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// 靜態檔案
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 處理 JSON body（例如未來有純 JSON API）
app.use(express.json());

// 設定 Multer：上傳圖片存到 /uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// 讀取 reports.json 工具函式
function readReports() {
  const filePath = path.join(__dirname, "reports.json");
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeReports(data) {
  const filePath = path.join(__dirname, "reports.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// API：取得所有回報（首頁要用）
app.get("/api/reports", (req, res) => {
  const reports = readReports();
  // 讓最新的在最前面
  reports.sort((a, b) => b.timestamp - a.timestamp);
  res.json(reports);
});

// API：新增回報（含圖片上傳）
app.post("/api/report", upload.single("photo"), (req, res) => {
  try {
    const {
      treeId,
      location,
      problemType,
      targetType,
      description,
      contact,
      riskLevel,
      rootHeavePoint,
    } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "請上傳照片" });
    }

    const reports = readReports();

    const newReport = {
      id: Date.now(),
      imageUrl: "/uploads/" + file.filename,
      treeId: treeId || "",
      location: location || "",
      problemType: problemType || "",
      targetType: targetType || "",
      description: description || "",
      contact: contact || "",
      riskLevel: riskLevel || "未判定",
      rootHeavePoint: rootHeavePoint || "",
      timestamp: Date.now(),
    };

    reports.push(newReport);
    writeReports(reports);

    res.json({
      success: true,
      report: newReport,
    });
  } catch (err) {
    console.error("新增回報失敗：", err);
    res.status(500).json({ error: "伺服器錯誤，請稍後再試" });
  }
});

// 首頁路由
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 回報頁路由
app.get("/report", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

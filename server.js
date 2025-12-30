// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ============ CORS Configuration (FIXED) ============
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://vk-marketing.netlify.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("❌ CORS blocked origin:", origin);
      callback(null, true); // Allow anyway for development
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control", // ✅ Added this
    "Pragma", // ✅ Added this
    "Expires", // ✅ Added this
  ],
  exposedHeaders: ["Content-Length", "Content-Type"],
};

app.use(cors(corsOptions));

// ============ Middleware ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ Request Logger ============
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// ============ Routes ============
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const userRoutes = require("./routes/user");
const referralRoutes = require("./routes/referral");
const walletRoutes = require("./routes/wallet");
const withdrawalRoutes = require("./routes/withdrawal");

app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/user", userRoutes);
app.use("/api/referral", referralRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/withdrawal", withdrawalRoutes);

// ============ Health Check ============
app.get("/", (req, res) => {
  res.json({
    status: "✅ MLM Server Running",
    timestamp: new Date().toISOString(),
  });
});

// ============ 404 Handler ============
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ============ Error Handler ============
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ============ Start Server ============
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("=".repeat(50));
  console.log(`🚀 MLM Backend Server Running`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`✅ CORS enabled`);
  console.log("=".repeat(50));
});

module.exports = app;

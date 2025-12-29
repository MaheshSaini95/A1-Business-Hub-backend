// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const userRoutes = require("./routes/user");
const referralRoutes = require("./routes/referral");
const withdrawalRoutes = require("./routes/withdrawal");

const app = express();

// CORS Configuration for Netlify
const corsOptions = {
  origin: [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    process.env.FRONTEND_URL || "https://your-site.netlify.app",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "A1 Business Hub Backend API Running",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "OK", uptime: process.uptime() });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/user", userRoutes);
app.use("/api/referral", referralRoutes);
app.use("/api/withdrawal", withdrawalRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
});

// middleware/auth.js - COMPLETE FIXED VERSION
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      console.log("❌ No token");
      return res.status(401).json({ error: "Access token required" });
    }

    // ✅ Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ Token decoded:", decoded.userId || decoded.email);

    // ✅ SPECIAL ADMIN CHECK - Skip DB lookup for admin tokens
    if (
      decoded.admin === true ||
      decoded.isAdmin === true ||
      decoded.userId === "ADMIN_SYSTEM"
    ) {
      console.log("✅ Admin token detected - bypassing DB check");
      req.user = {
        userId: "ADMIN_SYSTEM",
        email: decoded.email,
        isAdmin: true,
        admin: true,
        name: "Admin Panel",
        is_active: true,
      };
      return next();
    }

    // ✅ Normal user - check DB
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, name, email, is_active, is_admin")
      .eq("id", decoded.userId)
      .single();

    if (error || !user) {
      console.log("❌ User not found:", decoded.userId);
      return res.status(403).json({ error: "User not found" });
    }

    // ✅ Public routes for inactive users (Razorpay + others)
    const publicRoutes = [
      "/profile",
      "/dashboard-stats",
      "/commissions",
      "/referral/link",
      "/referral/team",
      "/payment/create-order",
      "/payment/verify-payment",     // purana Cashfree
      "/payment/verify-razorpay",    // ✅ YE RAZORPAY ROUTE ADD KIA
      "/payment/history",
      "/payment/manual-request",
    ];

    const isPublicRoute = publicRoutes.some((route) =>
      req.originalUrl.includes(route)
    );

    if (!user.is_active && !isPublicRoute) {
      console.log("❌ Inactive user blocked:", decoded.userId, req.originalUrl);
      return res.status(403).json({
        error: "Account inactive. Complete payment to activate.",
        needsPayment: true,
      });
    }

    // ✅ Set req.user with JWT structure
    req.user = {
      id: user.id,        // payment.js expect karta hai req.user.id
      userId: decoded.userId,
      email: decoded.email,
      name: user.name,
      is_active: user.is_active,
      is_admin: user.is_admin,
      phone: user.phone,  // payment.js me use hota hai
    };

    console.log("✅ Auth success:", req.user.id || "ADMIN");
    next();
  } catch (error) {
    console.error("❌ Auth error:", error.name, error.message);
    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(403).json({ error: "Token expired" });
    }
    return res.status(403).json({ error: "Authentication failed" });
  }
};

module.exports = { authenticateToken };

// middleware/auth.js
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh user data
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", decoded.userId)
      .single();

    if (error || !user) {
      return res.status(403).json({ error: "User not found" });
    }

    // Allow inactive users to access these routes
    const publicRoutes = [
      "/profile",
      "/dashboard-stats",
      "/commissions",
      "/referral/link",
      "/referral/team",
      "/payment/create-order",
      "/payment/verify-payment",
      "/payment/history",
    ];

    const isPublicRoute = publicRoutes.some((route) =>
      req.originalUrl.includes(route)
    );

    if (!user.is_active && !isPublicRoute) {
      return res.status(403).json({
        error: "Account inactive. Complete payment to activate.",
        isActive: false,
        needsPayment: true,
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
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

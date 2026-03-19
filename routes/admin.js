// routes/admin.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Middleware: allow only admin tokens
router.use(authenticateToken, (req, res, next) => {
  if (!req.user.isAdmin && !req.user.admin && req.user.userId !== "ADMIN_SYSTEM") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
});

/**
 * GET /api/admin/users
 * Simple user list + income fields
 */
router.get("/users", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, name, email, phone, is_active, wallet_balance, total_earnings, total_withdrawn")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ users: data || [] });
  } catch (err) {
    console.error("❌ Admin users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

/**
 * GET /api/admin/withdrawal-requests
 */
router.get("/withdrawal-requests", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("withdrawal_requests")
      .select(`
        id,
        amount,
        status,
        created_at,
        processed_at,
        users ( id, name, email )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ requests: data || [] });
  } catch (err) {
    console.error("❌ Admin withdrawals error:", err);
    res.status(500).json({ error: "Failed to load withdrawals" });
  }
});

module.exports = router;

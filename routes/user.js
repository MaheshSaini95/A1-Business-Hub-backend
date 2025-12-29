// routes/user.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/user/profile
 */
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    // Always fetch fresh data
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", req.user.id)
      .single();

    if (error) throw error;

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referral_code,
        walletBalance: parseFloat(user.wallet_balance || 0).toFixed(2),
        totalEarnings: parseFloat(user.total_earnings || 0).toFixed(2),
        totalWithdrawn: parseFloat(user.total_withdrawn || 0).toFixed(2),
        isActive: user.is_active,
        joinedAt: user.created_at,
      },
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

/**
 * GET /api/user/dashboard-stats
 */
router.get("/dashboard-stats", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fresh user data
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    // Direct referrals (Level 1)
    const { count: directReferrals } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("ancestor_id", userId)
      .eq("level", 1);

    // Total team (All levels)
    const { count: totalTeam } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("ancestor_id", userId);

    res.json({
      stats: {
        walletBalance: parseFloat(user.wallet_balance || 0).toFixed(2),
        totalEarnings: parseFloat(user.total_earnings || 0).toFixed(2),
        totalWithdrawn: parseFloat(user.total_withdrawn || 0).toFixed(2),
        directReferrals: directReferrals || 0,
        totalTeam: totalTeam || 0,
        isActive: user.is_active,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

/**
 * GET /api/user/commissions
 */
router.get("/commissions", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("commissions")
      .select(
        `
        *,
        source_user:source_user_id (name, referral_code)
      `
      )
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Commissions fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch commissions" });
    }

    res.json({ commissions: data || [] });
  } catch (error) {
    console.error("Commissions error:", error);
    res.status(500).json({ error: "Failed to load commissions" });
  }
});

module.exports = router;

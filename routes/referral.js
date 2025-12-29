// routes/referral.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/referral/team
 * Get team members by level
 */
router.get("/team", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { level } = req.query;

    let query = supabaseAdmin
      .from("referral_tree")
      .select(
        `
        level,
        user:user_id (
          id,
          name,
          email,
          phone,
          referral_code,
          wallet_balance,
          is_active,
          created_at
        )
      `
      )
      .eq("ancestor_id", userId)
      .order("level", { ascending: true });

    if (level) {
      query = query.eq("level", parseInt(level));
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: "Failed to fetch team" });
    }

    // Group by level
    const teamByLevel = {};
    data.forEach((item) => {
      if (!teamByLevel[item.level]) {
        teamByLevel[item.level] = [];
      }
      teamByLevel[item.level].push(item.user);
    });

    res.json({
      team: data,
      teamByLevel,
      totalMembers: data.length,
    });
  } catch (error) {
    console.error("Team fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/referral/link
 * Get referral link
 */
router.get("/link", authenticateToken, async (req, res) => {
  try {
    const referralCode = req.user.referral_code;
    const referralLink = `${process.env.FRONTEND_URL}/register.html?ref=${referralCode}`;

    res.json({
      referralCode,
      referralLink,
      shareMessage: `Join me on this platform! Use my referral code: ${referralCode}\n${referralLink}`,
    });
  } catch (error) {
    console.error("Referral link error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

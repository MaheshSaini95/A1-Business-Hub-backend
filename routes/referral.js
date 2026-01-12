// routes/referral.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const { generateReferralCode } = require("../utils/helpers");

const router = express.Router();

/**
 * GET /api/referral/team
 * Get team members by level
 */
router.get("/team", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
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
      .eq("referrer_id", userId)
      .order("level", { ascending: true });

    if (level) {
      query = query.eq("level", parseInt(level));
    }

    const { data, error } = await query;

    if (error) {
      console.error("❌ Team fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch team" });
    }

    const teamByLevel = {};
    (data || []).forEach((item) => {
      if (!teamByLevel[item.level]) teamByLevel[item.level] = [];
      teamByLevel[item.level].push(item.user);
    });

    res.json({
      team: data || [],
      teamByLevel,
      totalMembers: data?.length || 0,
    });
  } catch (error) {
    console.error("Team fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/referral/link
 * Get referral code + link (auto-generate if missing)
 */
router.get("/link", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    // Load user from DB to get latest referral_code
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, referral_code")
      .eq("id", userId)
      .single();

    if (error || !user) {
      console.error("❌ Referral link user error:", error);
      return res.status(404).json({ error: "User not found" });
    }

    let referralCode = user.referral_code;

    // If no code, generate and save
    if (!referralCode) {
      referralCode = generateReferralCode();
      await supabaseAdmin
        .from("users")
        .update({ referral_code: referralCode })
        .eq("id", userId);
    }

    const frontendBase =
      process.env.FRONTEND_URL || "http://127.0.0.1:5500/vk-marketing-frontend";
    const referralLink = `${frontendBase}/register.html?ref=${referralCode}`;

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

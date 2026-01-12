// routes/user.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const COMMISSION_CONFIG = require("../config/commissionConfig"); // ✅ Import from config

const router = express.Router();

/**
 * GET /api/user/profile
 */
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    console.log("👤 Fetching profile for:", userId);

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select(
        "id, name, email, phone, referral_code, wallet_balance, total_earnings, total_withdrawn, is_active"
      )
      .eq("id", userId)
      .single();

    if (error || !user) {
      console.error("❌ Profile fetch error:", error?.message);
      return res.status(404).json({ error: "User not found" });
    }

    // Generate referral code if missing
    if (!user.referral_code) {
      const { generateReferralCode } = require("../utils/helpers");
      const code = await generateReferralCode();
      await supabaseAdmin
        .from("users")
        .update({ referral_code: code })
        .eq("id", userId);
      user.referral_code = code;
    }

    console.log("✅ Profile loaded:", user.name, "| Code:", user.referral_code);
    res.json({ user });
  } catch (error) {
    console.error("❌ Profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/user/dashboard-stats
 */
router.get("/dashboard-stats", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    console.log("📊 Loading stats for:", userId);

    // Get user wallet data
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("wallet_balance, total_earnings, total_withdrawn")
      .eq("id", userId)
      .single();

    // Count direct referrals (Level 1 from referral_tree)
    const { count: directReferrals } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("level", 1);

    // Count total team (all levels from referral_tree)
    const { count: totalTeam } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId);

    // Count rewards claimed
    const { count: rewardsClaimed } = await supabaseAdmin
      .from("rewards")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    // Calculate total rewards amount
    const { data: rewardsData } = await supabaseAdmin
      .from("rewards")
      .select("reward_amount")
      .eq("user_id", userId);

    const totalRewardsAmount =
      rewardsData?.reduce(
        (sum, r) => sum + parseFloat(r.reward_amount || 0),
        0
      ) || 0;

    const stats = {
      walletBalance: parseFloat(user?.wallet_balance || 0).toFixed(2),
      totalEarnings: parseFloat(user?.total_earnings || 0).toFixed(2),
      totalRewards: totalRewardsAmount.toFixed(2),
      directReferrals: directReferrals || 0,
      totalTeam: totalTeam || 0,
      rewardsClaimed: rewardsClaimed || 0,
    };

    console.log("✅ Stats loaded:", stats);
    res.json({ stats });
  } catch (error) {
    console.error("❌ Stats error:", error);
    res.status(500).json({
      stats: {
        walletBalance: "0.00",
        totalEarnings: "0.00",
        totalRewards: "0.00",
        directReferrals: 0,
        totalTeam: 0,
        rewardsClaimed: 0,
      },
    });
  }
});

/**
 * GET /api/user/reward-progress
 */
router.get("/reward-progress", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    console.log("🎁 Loading reward progress for:", userId);

    // Get team counts for ALL 10 levels from referral_tree
    const currentTeams = {};
    for (let level = 1; level <= 10; level++) {
      const { count } = await supabaseAdmin
        .from("referral_tree")
        .select("*", { count: "exact", head: true })
        .eq("referrer_id", userId)
        .eq("level", level);

      currentTeams[`level${level}`] = count || 0;
    }

    // Get claimed rewards
    const { data: claimedRewardsData } = await supabaseAdmin
      .from("rewards")
      .select("level, milestone_teams")
      .eq("user_id", userId);

    const claimed = {};
    for (let level = 1; level <= 10; level++) {
      claimed[`level${level}`] =
        claimedRewardsData
          ?.filter((r) => r.level === level)
          .map((r) => r.milestone_teams) || [];
    }

    // Find next reward for each level
    const nextRewards = {};
    for (let level = 1; level <= 10; level++) {
      const levelKey = `LEVEL_${level}`;
      const rewardsForLevel = COMMISSION_CONFIG.REWARDS[levelKey] || [];
      const currentCount = currentTeams[`level${level}`];

      nextRewards[`level${level}`] =
        rewardsForLevel.find((r) => r.teams > currentCount) || null;
    }

    const response = {
      currentTeams,
      nextRewards,
      claimed,
      allRewards: COMMISSION_CONFIG.REWARDS, // ✅ From config file
    };

    console.log("✅ Reward progress loaded");
    res.json(response);
  } catch (error) {
    console.error("❌ Reward progress error:", error);
    res.status(500).json({ error: "Failed to load reward progress" });
  }
});

/**
 * GET /api/user/commissions
 */
router.get("/commissions", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const { data: commissions, error } = await supabaseAdmin
      .from("commissions")
      .select(
        `
        *,
        source_user:source_user_id (name, email)
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("❌ Commissions error:", error);
      return res.json({ commissions: [] });
    }

    console.log(`✅ Loaded ${commissions?.length || 0} commissions`);
    res.json({ commissions: commissions || [] });
  } catch (error) {
    console.error("❌ Commissions fetch error:", error);
    res.json({ commissions: [] });
  }
});

module.exports = router;

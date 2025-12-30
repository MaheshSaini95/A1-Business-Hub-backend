// routes/user.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const COMMISSION_CONFIG = require("../config/commissionConfig");

const router = express.Router();

/**
 * GET /api/user/profile
 */
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    console.log("👤 Fetching profile for user:", req.user.id);

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", req.user.id)
      .single();

    if (error) {
      console.error("❌ Profile fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch profile" });
    }

    // ✅ Log the actual database values
    console.log("✅ User data from DB:");
    console.log("  - wallet_balance:", user.wallet_balance);
    console.log("  - total_earnings:", user.total_earnings);
    console.log("  - total_withdrawn:", user.total_withdrawn);

    res.json({ user });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/user/dashboard-stats
 */
// routes/user.js - Update the dashboard-stats endpoint

router.get("/dashboard-stats", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user data
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    // Count direct referrals (Level 1)
    const { count: directReferrals } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("level", 1);

    // Count total team (all levels)
    const { count: totalTeam } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId);

    // Count total commissions
    const { count: totalCommissions } = await supabaseAdmin
      .from("commissions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    // Count rewards claimed
    const { count: totalRewardsClaimed } = await supabaseAdmin
      .from("rewards")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const response = {
      walletBalance: parseFloat(user?.wallet_balance || 0).toFixed(2),
      totalEarnings: parseFloat(user?.total_earnings || 0).toFixed(2),
      totalWithdrawn: parseFloat(user?.total_withdrawn || 0).toFixed(2),
      // ✅ FIX: Return total_earnings instead of total_rewards
      totalRewards: parseFloat(user?.total_earnings || 0).toFixed(2), // Changed this line
      directReferrals: directReferrals || 0,
      totalTeam: totalTeam || 0,
      totalCommissions: totalCommissions || 0,
      totalRewardsClaimed: totalRewardsClaimed || 0,
    };

    res.json({ stats: response });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/user/commissions
 */
router.get("/commissions", authenticateToken, async (req, res) => {
  try {
    const { data: commissions, error } = await supabaseAdmin
      .from("commissions")
      .select(
        `
        *,
        source_user:source_user_id (
          name,
          email
        )
      `
      )
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Commissions error:", error);
      return res.status(500).json({ error: "Failed to fetch commissions" });
    }

    res.json({ commissions: commissions || [] });
  } catch (error) {
    console.error("Commissions fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/user/rewards
 */
router.get("/rewards", authenticateToken, async (req, res) => {
  try {
    const { data: rewards, error } = await supabaseAdmin
      .from("rewards")
      .select("*")
      .eq("user_id", req.user.id)
      .order("claimed_at", { ascending: false });

    if (error) {
      console.error("Rewards error:", error);
      return res.status(500).json({ error: "Failed to fetch rewards" });
    }

    res.json({ rewards: rewards || [] });
  } catch (error) {
    console.error("Rewards fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/user/reward-progress
 */
// routes/user.js - Update reward-progress endpoint

router.get("/reward-progress", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get team counts for ALL 10 levels
    const teamCounts = {};
    const nextRewards = {};
    const claimedRewards = {};

    // Fetch counts for all 10 levels
    for (let level = 1; level <= 10; level++) {
      const { count } = await supabaseAdmin
        .from("referral_tree")
        .select("*", { count: "exact", head: true })
        .eq("referrer_id", userId)
        .eq("level", level);

      teamCounts[`level${level}`] = count || 0;
    }

    // Get claimed rewards for all levels
    const { data: allClaimedRewards } = await supabaseAdmin
      .from("rewards")
      .select("level, milestone_teams")
      .eq("user_id", userId);

    // Organize claimed rewards by level
    for (let level = 1; level <= 10; level++) {
      claimedRewards[`level${level}`] =
        allClaimedRewards
          ?.filter((r) => r.level === level)
          .map((r) => r.milestone_teams) || [];
    }

    // Find next reward for each level
    for (let level = 1; level <= 10; level++) {
      const levelKey = `LEVEL_${level}`;
      const rewardsForLevel = COMMISSION_CONFIG.REWARDS[levelKey] || [];
      const currentCount = teamCounts[`level${level}`];

      nextRewards[`level${level}`] =
        rewardsForLevel.find((r) => r.teams > currentCount) || null;
    }

    res.json({
      currentTeams: teamCounts,
      nextRewards: nextRewards,
      claimed: claimedRewards,
      allRewards: COMMISSION_CONFIG.REWARDS,
    });
  } catch (error) {
    console.error("❌ Reward progress error:", error);
    res.status(500).json({ error: "Failed to fetch reward progress" });
  }
});

/**
 * GET /api/user/transactions
 */
router.get("/transactions", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Commissions
    const { data: commissions } = await supabaseAdmin
      .from("commissions")
      .select("amount, created_at, commission_type, level")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    // Rewards
    const { data: rewards } = await supabaseAdmin
      .from("rewards")
      .select(
        "reward_amount as amount, claimed_at as created_at, reward_title, level"
      )
      .eq("user_id", userId)
      .order("claimed_at", { ascending: false })
      .limit(20);

    // Withdrawals
    const { data: withdrawals } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("amount, created_at, status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    // Combine and sort
    const transactions = [
      ...(commissions || []).map((c) => ({
        ...c,
        type: `Commission L${c.level}`,
      })),
      ...(rewards || []).map((r) => ({
        ...r,
        type: `Reward: ${r.reward_title}`,
      })),
      ...(withdrawals || []).map((w) => ({
        ...w,
        type: `Withdrawal (${w.status})`,
        amount: -w.amount,
      })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ transactions: transactions.slice(0, 50) });
  } catch (error) {
    console.error("Transactions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

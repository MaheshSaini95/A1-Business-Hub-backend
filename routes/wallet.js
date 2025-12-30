// routes/wallet.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/wallet/balance
 */
router.get("/balance", authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("wallet_balance, total_earnings, total_withdrawn")
      .eq("id", req.user.id)
      .single();

    if (error) {
      return res.status(500).json({ error: "Failed to fetch wallet balance" });
    }

    res.json({
      balance: parseFloat(user.wallet_balance || 0).toFixed(2),
      totalEarnings: parseFloat(user.total_earnings || 0).toFixed(2),
      totalWithdrawn: parseFloat(user.total_withdrawn || 0).toFixed(2),
    });
  } catch (error) {
    console.error("Wallet balance error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/wallet/transactions
 */
router.get("/transactions", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all wallet transactions
    const { data: commissions } = await supabaseAdmin
      .from("commissions")
      .select("amount, created_at, level, commission_type")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const { data: rewards } = await supabaseAdmin
      .from("rewards")
      .select("reward_amount as amount, claimed_at as created_at, reward_title")
      .eq("user_id", userId)
      .order("claimed_at", { ascending: false });

    const transactions = [
      ...(commissions || []).map((c) => ({
        type: "commission",
        amount: parseFloat(c.amount),
        description: `Level ${c.level} Commission`,
        date: c.created_at,
      })),
      ...(rewards || []).map((r) => ({
        type: "reward",
        amount: parseFloat(r.amount),
        description: r.reward_title,
        date: r.created_at,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ transactions });
  } catch (error) {
    console.error("Wallet transactions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

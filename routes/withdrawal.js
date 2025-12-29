// routes/withdrawal.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const COMMISSION_CONFIG = require("../config/commissionConfig");

const router = express.Router();

/**
 * POST /api/withdrawal/request
 * Create withdrawal request
 */
router.post("/request", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, bankDetails } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (amount < COMMISSION_CONFIG.MIN_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is ₹${COMMISSION_CONFIG.MIN_WITHDRAWAL_AMOUNT}`,
      });
    }

    if (
      !bankDetails ||
      !bankDetails.accountNumber ||
      !bankDetails.ifsc ||
      !bankDetails.accountHolder
    ) {
      return res.status(400).json({ error: "Bank details required" });
    }

    // Check wallet balance
    if (parseFloat(req.user.wallet_balance) < amount) {
      return res.status(400).json({ error: "Insufficient wallet balance" });
    }

    // Check for pending withdrawals
    const { data: pendingRequest } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .single();

    if (pendingRequest) {
      return res
        .status(400)
        .json({ error: "You already have a pending withdrawal request" });
    }

    // Create withdrawal request
    const { data: withdrawal, error } = await supabaseAdmin
      .from("withdrawal_requests")
      .insert({
        user_id: userId,
        amount: amount,
        status: "pending",
        bank_details: bankDetails,
      })
      .select()
      .single();

    if (error) {
      console.error("Withdrawal creation error:", error);
      return res
        .status(500)
        .json({ error: "Failed to create withdrawal request" });
    }

    res.json({
      message: "Withdrawal request submitted successfully",
      withdrawal: {
        id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        createdAt: withdrawal.created_at,
      },
    });
  } catch (error) {
    console.error("Withdrawal request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/withdrawal/history
 * Get withdrawal history
 */
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to fetch withdrawal history" });
    }

    res.json({ withdrawals: data });
  } catch (error) {
    console.error("Withdrawal history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/withdrawal/approve/:id (ADMIN ONLY)
 * Approve withdrawal request
 */
router.post("/approve/:id", authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check middleware
    const withdrawalId = req.params.id;
    const { adminNotes } = req.body;

    // Get withdrawal request
    const { data: withdrawal, error: fetchError } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("*")
      .eq("id", withdrawalId)
      .single();

    if (fetchError || !withdrawal) {
      return res.status(404).json({ error: "Withdrawal request not found" });
    }

    if (withdrawal.status !== "pending") {
      return res.status(400).json({ error: "Withdrawal already processed" });
    }

    // Deduct from wallet
    const { error: walletError } = await supabaseAdmin
      .from("users")
      .update({
        wallet_balance: supabaseAdmin.raw(
          `wallet_balance - ${withdrawal.amount}`
        ),
        total_withdrawn: supabaseAdmin.raw(
          `total_withdrawn + ${withdrawal.amount}`
        ),
      })
      .eq("id", withdrawal.user_id);

    if (walletError) {
      return res.status(500).json({ error: "Failed to update wallet" });
    }

    // Update withdrawal status
    const { error: updateError } = await supabaseAdmin
      .from("withdrawal_requests")
      .update({
        status: "approved",
        admin_notes: adminNotes,
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", withdrawalId);

    if (updateError) {
      return res.status(500).json({ error: "Failed to approve withdrawal" });
    }

    res.json({ message: "Withdrawal approved successfully" });
  } catch (error) {
    console.error("Withdrawal approval error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

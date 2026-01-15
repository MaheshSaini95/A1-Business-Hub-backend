// routes/withdrawal.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/**
 * POST /api/withdrawal/request
 */
router.post("/request", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, bankDetails } = req.body;

    console.log("\n=== WITHDRAWAL REQUEST START ===");
    console.log("📥 User ID:", userId);
    console.log("💸 Amount:", amount);
    console.log("🏦 Bank Details:", bankDetails);

    // Validate amount
    if (!amount || amount < 100) {
      return res
        .status(400)
        .json({ error: "Minimum withdrawal amount is ₹100" });
    }

    // Validate bank details
    if (
      !bankDetails ||
      !bankDetails.accountHolder ||
      !bankDetails.accountNumber ||
      !bankDetails.ifsc ||
      !bankDetails.bankName
    ) {
      return res
        .status(400)
        .json({ error: "Please provide complete bank details" });
    }

    // STEP 1: Get user's current balance
    console.log("\n📊 STEP 1: Fetching user balance...");
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("wallet_balance, total_withdrawn, name, email")
      .eq("id", userId)
      .single();

    if (userError) {
      console.error("❌ User fetch error:", userError);
      return res.status(500).json({ error: "Failed to fetch user balance" });
    }

    if (!user) {
      console.error("❌ User not found");
      return res.status(404).json({ error: "User not found" });
    }

    const currentBalance = parseFloat(user.wallet_balance || 0);
    const currentWithdrawn = parseFloat(user.total_withdrawn || 0);

    console.log("✅ Current balance:", currentBalance);
    console.log("✅ Current total withdrawn:", currentWithdrawn);

    // Check sufficient balance
    if (currentBalance < amount) {
      console.log("❌ Insufficient balance");
      return res.status(400).json({
        error: `Insufficient balance. Available: ₹${currentBalance.toFixed(2)}`,
      });
    }

    // Calculate new values
    const newBalance = currentBalance - amount;
    const newTotalWithdrawn = currentWithdrawn + amount;

    console.log("\n💰 Calculations:");
    console.log("New balance:", newBalance);
    console.log("New total withdrawn:", newTotalWithdrawn);

    // STEP 2: Create withdrawal request
    console.log("\n📝 STEP 2: Creating withdrawal request...");
    const { data: withdrawal, error: withdrawalError } = await supabaseAdmin
      .from("withdrawal_requests")
      .insert({
        user_id: userId,
        amount: amount,
        bank_details: bankDetails,
        status: "pending",
      })
      .select()
      .single();

    if (withdrawalError) {
      console.error("❌ Withdrawal insert error:", withdrawalError);
      return res
        .status(500)
        .json({ error: "Failed to create withdrawal request" });
    }

    console.log("✅ Withdrawal request created:", withdrawal.id);

    // STEP 3: Update wallet balance
    console.log("\n💳 STEP 3: Updating wallet balance...");
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        wallet_balance: newBalance,
        total_withdrawn: newTotalWithdrawn,
      })
      .eq("id", userId)
      .select("wallet_balance, total_withdrawn")
      .single();

    if (updateError) {
      console.error("❌ Wallet update error:", updateError);

      // ROLLBACK: Delete withdrawal request
      console.log("🔄 Rolling back withdrawal request...");
      await supabaseAdmin
        .from("withdrawal_requests")
        .delete()
        .eq("id", withdrawal.id);

      return res.status(500).json({ error: "Failed to process withdrawal" });
    }

    console.log("✅ Wallet updated successfully!");
    console.log("New wallet_balance in DB:", updatedUser.wallet_balance);
    console.log("New total_withdrawn in DB:", updatedUser.total_withdrawn);

    // Verify the update
    const { data: verifyUser, error: verifyError } = await supabaseAdmin
      .from("users")
      .select("wallet_balance, total_withdrawn")
      .eq("id", userId)
      .single();

    if (!verifyError && verifyUser) {
      console.log("\n✅ VERIFICATION:");
      console.log("Verified wallet_balance:", verifyUser.wallet_balance);
      console.log("Verified total_withdrawn:", verifyUser.total_withdrawn);
    }

    const responseData = {
      success: true,
      message: "Withdrawal request submitted successfully",
      withdrawal: {
        id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        created_at: withdrawal.created_at,
      },
      newBalance: parseFloat(updatedUser.wallet_balance).toFixed(2),
      totalWithdrawn: parseFloat(updatedUser.total_withdrawn).toFixed(2),
    };

    console.log("\n📤 Response:", responseData);
    console.log("=== WITHDRAWAL REQUEST END ===\n");

    res.json(responseData);
  } catch (error) {
    console.error("\n❌ WITHDRAWAL REQUEST ERROR:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

/**
 * GET /api/withdrawal/history
 */
router.get("/history", authenticateToken, async (req, res) => {
  try {
    console.log("📜 Fetching withdrawal history for user:", req.user.id);

    const { data: withdrawals, error } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Withdrawal history error:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch withdrawal history" });
    }

    console.log(`✅ Found ${withdrawals?.length || 0} withdrawal records`);
    res.json({ withdrawals: withdrawals || [] });
  } catch (error) {
    console.error("❌ Withdrawal history fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/withdrawal/pending (Admin only)
 */
router.get("/pending", authenticateToken, async (req, res) => {
  try {
    const { data: withdrawals, error } = await supabaseAdmin
      .from("withdrawal_requests")
      .select(
        `
        *,
        user:user_id (
          name,
          email,
          phone
        )
      `
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Pending withdrawals error:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch pending withdrawals" });
    }

    res.json({ withdrawals: withdrawals || [] });
  } catch (error) {
    console.error("❌ Pending withdrawals error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/withdrawal/:id/approve (Admin only)
 */
router.put("/:id/approve", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("withdrawal_requests")
      .update({
        status: "approved",
        processed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("❌ Approve error:", error);
      return res.status(500).json({ error: "Failed to approve withdrawal" });
    }

    console.log("✅ Withdrawal approved:", id);
    res.json({ message: "Withdrawal approved successfully" });
  } catch (error) {
    console.error("❌ Approve withdrawal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/withdrawal/:id/reject (Admin only)
 */
router.put("/:id/reject", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Get withdrawal details
    const { data: withdrawal, error: fetchError } = await supabaseAdmin
      .from("withdrawal_requests")
      .select("user_id, amount, status")
      .eq("id", id)
      .single();

    if (fetchError || !withdrawal) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    if (withdrawal.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Only pending withdrawals can be rejected" });
    }

    // Reject withdrawal
    const { error: updateError } = await supabaseAdmin
      .from("withdrawal_requests")
      .update({
        status: "rejected",
        rejection_reason: reason || "No reason provided",
        processed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      console.error("❌ Reject error:", updateError);
      return res.status(500).json({ error: "Failed to reject withdrawal" });
    }

    // REFUND: Add amount back to wallet
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("wallet_balance, total_withdrawn")
      .eq("id", withdrawal.user_id)
      .single();

    if (!userError && user) {
      const refundedBalance =
        parseFloat(user.wallet_balance) + parseFloat(withdrawal.amount);
      const refundedWithdrawn =
        parseFloat(user.total_withdrawn) - parseFloat(withdrawal.amount);

      await supabaseAdmin
        .from("users")
        .update({
          wallet_balance: refundedBalance,
          total_withdrawn: refundedWithdrawn,
        })
        .eq("id", withdrawal.user_id);

      console.log("✅ Amount refunded to wallet");
    }

    console.log("✅ Withdrawal rejected:", id);
    res.json({ message: "Withdrawal rejected and amount refunded to wallet" });
  } catch (error) {
    console.error("❌ Reject withdrawal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

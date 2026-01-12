// routes/admin.js
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const { ensureUniqueReferralCode } = require("../utils/helpers");
const { distributeCommissions } = require("../services/commissionService");

const router = express.Router();

/**
 * Admin guard
 */
async function adminOnly(req, res, next) {
  try {
    const adminUserId = req.user.userId;

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, is_admin")
      .eq("id", adminUserId)
      .single();

    if (error || !user || !user.is_admin) {
      if (req.user.admin || req.user.email === "admin@a1businesshub.com") {
        req.user.isAdmin = true;
        return next();
      }
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user.isAdmin = true;
    next();
  } catch (err) {
    console.error("Admin auth error:", err);
    return res.status(500).json({ error: "Auth error" });
  }
}

// Mark admin token as admin
router.use((req, res, next) => {
  if (req.user?.admin || req.user?.email === "admin@a1businesshub.com") {
    req.user.isAdmin = true;
  }
  next();
});

/**
 * GET /api/admin/activation-requests
 */
router.get(
  "/activation-requests",
  authenticateToken,
  adminOnly,
  async (req, res) => {
    try {
      console.log("📊 Admin fetching activation requests...");

      const { data, error } = await supabaseAdmin
        .from("payments")
        .select(
          `
        id,
        user_id,
        amount,
        status,
        payment_mode,
        payment_type,
        created_at,
        users (
          id,
          name,
          email,
          referred_by
        )
      `
        )
        .eq("payment_type", "joining_fee")
        .eq("payment_mode", "manual_qr")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      console.log(`✅ Found ${data?.length || 0} requests`);
      res.json({ requests: data || [] });
    } catch (err) {
      console.error("❌ Activation requests error:", err);
      res.status(500).json({ error: "Failed to fetch requests" });
    }
  }
);

/**
 * POST /api/admin/activation-requests/:id/approve
 * Activate user + referral code + welcome bonus + multi-level commissions
 */
router.post(
  "/activation-requests/:id/approve",
  authenticateToken,
  adminOnly,
  async (req, res) => {
    try {
      const paymentId = req.params.id;
      console.log(`🎉 Approving payment ID: ${paymentId}`);

      // 1. Load payment + user
      const { data: payment, error: payError } = await supabaseAdmin
        .from("payments")
        .select(
          `
        id,
        user_id,
        amount,
        status,
        users (
          id,
          name,
          email,
          referred_by,
          referral_code
        )
      `
        )
        .eq("id", paymentId)
        .single();

      if (payError || !payment) {
        console.error("Payment fetch error:", payError);
        return res.status(404).json({ error: "Payment not found" });
      }

      const userId = payment.users.id;
      const userName = payment.users.name;
      const joiningAmount = payment.amount;

      console.log(`👤 Activating user: ${userName} (${userId})`);

      // 2. Generate unique referral code (if missing)
      let referralCode = payment.users.referral_code;
      if (!referralCode) {
        referralCode = await ensureUniqueReferralCode();
      }

      // 3. Activate user + set referral code
      const { error: userUpdateError } = await supabaseAdmin
        .from("users")
        .update({
          is_active: true,
          referral_code: referralCode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (userUpdateError) throw userUpdateError;

      // 4. Update payment status
      const { error: payUpdateError } = await supabaseAdmin
        .from("payments")
        .update({
          status: "approved",
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      if (payUpdateError) throw payUpdateError;

      // 5. Welcome bonus ₹50 to user
      const { error: bonusError } = await supabaseAdmin.rpc(
        "increment_wallet",
        {
          user_id_param: userId,
          amount_param: 50,
        }
      );
      if (bonusError) {
        console.error("Welcome bonus error:", bonusError);
      } else {
        console.log(`💰 Welcome bonus ₹50 added to ${userName}`);
      }

      // 6. Direct referral bonus ₹50 (if referred_by)
      // if (payment.users.referred_by) {
      //   const { error: refBonusError } = await supabaseAdmin.rpc(
      //     "increment_wallet",
      //     {
      //       user_id_param: payment.users.referred_by,
      //       amount_param: 50,
      //     }
      //   );
      //   if (refBonusError) {
      //     console.error("Referrer bonus error:", refBonusError);
      //   } else {
      //     console.log(`💰 Referral commission ₹50 to referrer`);
      //   }
      // }

      // 7. Multi-level commissions (level 1–10) from referral_tree
      try {
        console.log(`💰 Starting multi-level commission distribution...`);
        await distributeCommissions(userId, paymentId, joiningAmount);
      } catch (e) {
        console.error("❌ distributeCommissions error:", e);
      }

      console.log(`✅ COMPLETE: ${userName} activated! Code: ${referralCode}`);

      res.json({
        success: true,
        message: `✅ User activated! Referral: ${referralCode}`,
        referralCode,
      });
    } catch (err) {
      console.error("❌ APPROVE ERROR:", err);
      res.status(500).json({ error: "Failed to approve" });
    }
  }
);

/**
 * POST /api/admin/activation-requests/:id/reject
 */
router.post(
  "/activation-requests/:id/reject",
  authenticateToken,
  adminOnly,
  async (req, res) => {
    try {
      const paymentId = req.params.id;
      const { note } = req.body;

      await supabaseAdmin
        .from("payments")
        .update({
          status: "rejected",
          note: note || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      console.log(`❌ Payment ${paymentId} rejected`);
      res.json({ success: true, message: "Request rejected" });
    } catch (err) {
      console.error("❌ Reject error:", err);
      res.status(500).json({ error: "Failed to reject request" });
    }
  }
);

// routes/admin.js - ADD THESE ENDPOINTS

/**
 * GET /api/admin/withdrawal-requests
 * Get all pending withdrawal requests
 */
router.get(
  "/withdrawal-requests",
  authenticateToken,
  adminOnly,
  async (req, res) => {
    try {
      console.log("💳 Admin fetching withdrawal requests...");

      const { data, error } = await supabaseAdmin
        .from("withdrawal_requests")
        .select(
          `
          id,
          user_id,
          amount,
          status,
          bank_details,
          created_at,
          processed_at,
          rejection_reason,
          users (
            id,
            name,
            email,
            phone
          )
        `
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      console.log(`✅ Found ${data?.length || 0} pending withdrawals`);
      res.json({ withdrawals: data || [] });
    } catch (err) {
      console.error("❌ Withdrawal requests error:", err);
      res.status(500).json({ error: "Failed to fetch withdrawal requests" });
    }
  }
);

/**
 * POST /api/admin/withdrawal-requests/:id/approve
 * Approve withdrawal request (money already deducted from wallet)
 */
router.post(
  "/withdrawal-requests/:id/approve",
  authenticateToken,
  adminOnly,
  async (req, res) => {
    try {
      const withdrawalId = req.params.id;
      console.log(`✅ Approving withdrawal ID: ${withdrawalId}`);

      // Get withdrawal details
      const { data: withdrawal, error: fetchError } = await supabaseAdmin
        .from("withdrawal_requests")
        .select("id, user_id, amount, status")
        .eq("id", withdrawalId)
        .single();

      if (fetchError || !withdrawal) {
        return res.status(404).json({ error: "Withdrawal request not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({
          error: "Only pending withdrawals can be approved",
        });
      }

      // Update withdrawal status to approved
      const { error: updateError } = await supabaseAdmin
        .from("withdrawal_requests")
        .update({
          status: "approved",
          processed_at: new Date().toISOString(),
        })
        .eq("id", withdrawalId);

      if (updateError) throw updateError;

      console.log(
        `✅ Withdrawal approved: ${withdrawalId} | Amount: ₹${withdrawal.amount}`
      );

      res.json({
        success: true,
        message: "Withdrawal approved successfully",
      });
    } catch (err) {
      console.error("❌ Approve withdrawal error:", err);
      res.status(500).json({ error: "Failed to approve withdrawal" });
    }
  }
);

/**
 * POST /api/admin/withdrawal-requests/:id/reject
 * Reject withdrawal and refund to wallet
 */
router.post(
  "/withdrawal-requests/:id/reject",
  authenticateToken,
  adminOnly,
  async (req, res) => {
    try {
      const withdrawalId = req.params.id;
      const { reason } = req.body;

      console.log(`❌ Rejecting withdrawal ID: ${withdrawalId}`);

      // Get withdrawal details
      const { data: withdrawal, error: fetchError } = await supabaseAdmin
        .from("withdrawal_requests")
        .select("id, user_id, amount, status")
        .eq("id", withdrawalId)
        .single();

      if (fetchError || !withdrawal) {
        return res.status(404).json({ error: "Withdrawal request not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({
          error: "Only pending withdrawals can be rejected",
        });
      }

      // Update withdrawal status to rejected
      const { error: updateError } = await supabaseAdmin
        .from("withdrawal_requests")
        .update({
          status: "rejected",
          rejection_reason: reason || "Rejected by admin",
          processed_at: new Date().toISOString(),
        })
        .eq("id", withdrawalId);

      if (updateError) throw updateError;

      // REFUND: Add amount back to user's wallet
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
            total_withdrawn: Math.max(0, refundedWithdrawn), // Prevent negative
          })
          .eq("id", withdrawal.user_id);

        console.log(
          `💰 Refunded ₹${withdrawal.amount} to user ${withdrawal.user_id}`
        );
      }

      console.log(`✅ Withdrawal rejected: ${withdrawalId}`);

      res.json({
        success: true,
        message: "Withdrawal rejected and amount refunded to wallet",
      });
    } catch (err) {
      console.error("❌ Reject withdrawal error:", err);
      res.status(500).json({ error: "Failed to reject withdrawal" });
    }
  }
);

module.exports = router;

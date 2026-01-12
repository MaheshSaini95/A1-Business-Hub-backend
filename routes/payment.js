// routes/payment.js - REPLACE ENTIRE FILE
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.post("/manual-request", authenticateToken, async (req, res) => {
  try {
    console.log("📥 /payment/manual-request HIT");
    console.log("req.user:", req.user);

    // ✅ Now works - req.user.userId exists
    const userId = req.user.userId;
    const { amount, paymentType } = req.body;

    const finalAmount = amount || 295;

    // Get user details
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, name")
      .eq("id", userId)
      .single();

    // Create payment record
    const { data: payment, error } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: userId,
        amount: finalAmount,
        payment_type: paymentType || "joining_fee",
        payment_mode: "manual_qr",
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("❌ Payment error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    console.log(`✅ Payment created: ID ${payment.id} for ${user.name}`);

    res.json({
      success: true,
      paymentId: payment.id,
      userId,
      name: user.name,
      amount: finalAmount,
      status: "pending",
    });
  } catch (err) {
    console.error("❌ Payment endpoint error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

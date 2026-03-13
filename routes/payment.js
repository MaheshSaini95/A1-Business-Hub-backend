// routes/payment.js
const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const {
  buildReferralTree,
  distributeCommissions,
} = require("../services/commissionService");
const COMMISSION_CONFIG = require("../config/commissionConfig");
const { generateReferralCode } = require("../utils/helpers");

const router = express.Router();

// Razorpay instance
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

/**
 * POST /api/payment/create-order
 */
router.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name;
    const userEmail = req.user.email;
    const userPhone = req.user.phone;

    console.log("=== Creating Razorpay Payment Order ===");
    console.log("User:", { userId, userName, userEmail, userPhone });

    if (!userId) {
      return res.status(400).json({ error: "User ID missing from token" });
    }

    // Check if already paid
    const { data: existingPayment } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("user_id", userId)
      .eq("payment_type", "joining_fee")
      .eq("status", "completed")
      .maybeSingle();

    if (existingPayment) {
      console.log("⚠️ User already paid");
      return res.status(400).json({ error: "Joining fee already paid" });
    }

    // Validate environment variables
    if (
      !process.env.FRONTEND_URL ||
      !process.env.BACKEND_URL ||
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_SECRET_KEY
    ) {
      console.error("❌ Missing environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const orderId = `ORDER_${Date.now()}_${userId.substring(0, 8)}`;

    // Clean phone number
    let cleanPhone = (userPhone || "").replace(/\D/g, "");
    if (cleanPhone.length > 10) {
      cleanPhone = cleanPhone.slice(-10);
    }

    const amountInPaise = COMMISSION_CONFIG.JOINING_FEE * 100;

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: orderId,
      notes: {
        user_id: userId,
        user_name: userName,
        user_email: userEmail,
        user_phone: cleanPhone,
        payment_type: "joining_fee",
      },
    };

    console.log("📦 Razorpay Order Options:", JSON.stringify(options, null, 2));

    const razorpayOrder = await razorpayInstance.orders.create(options);
    console.log("✅ Razorpay order created:", razorpayOrder.id);

    // Save to database — delete any old pending order first
    await supabaseAdmin
      .from("payments")
      .delete()
      .eq("user_id", userId)
      .eq("payment_type", "joining_fee")
      .eq("status", "pending");

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: userId,
        amount: COMMISSION_CONFIG.JOINING_FEE,
        payment_type: "joining_fee",
        status: "pending",
        transaction_id: orderId,
        metadata: {
          razorpay_order_id: razorpayOrder.id,
        },
      })
      .select()
      .single();

    if (paymentError) {
      console.error("❌ Payment record error:", paymentError);
      return res.status(500).json({ error: "Failed to create payment record" });
    }

    console.log("✅ Payment order created successfully");

    res.json({
      success: true,
      orderId: orderId,
      razorpayOrderId: razorpayOrder.id,
      amount: COMMISSION_CONFIG.JOINING_FEE,
      currency: "INR",
      razorpayKey: process.env.RAZORPAY_KEY_ID,
      user: {
        name: userName,
        email: userEmail,
        phone: cleanPhone,
      },
    });
  } catch (error) {
    console.error("❌ Create Razorpay order error:", error);
    res.status(500).json({
      error: "Failed to create order",
      details: error.message,
    });
  }
});

/**
 * POST /api/payment/verify-razorpay
 */
router.post("/verify-razorpay", authenticateToken, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId,
    } = req.body;

    const userId = req.user.id;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !orderId
    ) {
      return res.status(400).json({ error: "Invalid payment details" });
    }

    console.log("=== Razorpay Payment Verification ===");
    console.log("Internal Order ID:", orderId);
    console.log("User ID:", userId);

    // ✅ Verify signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET_KEY)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      console.error("❌ Signature verification failed");
      return res.status(400).json({ error: "Payment signature invalid" });
    }

    console.log("✅ Razorpay signature verified");

    // ✅ Update payment record to completed
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from("payments")
      .update({
        status: "completed",
        metadata: {
          razorpay_order_id,
          razorpay_payment_id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("transaction_id", orderId)
      .eq("user_id", userId)
      .select()
      .single();

    if (paymentError || !paymentRecord) {
      console.error("❌ Payment update error:", paymentError);
      return res.status(500).json({ error: "Failed to update payment record" });
    }

    console.log("✅ Payment record updated, ID:", paymentRecord.id);

    // ✅ Generate unique referral code
    let referralCode = null;
    let attempts = 0;
    while (!referralCode && attempts < 10) {
      attempts++;
      const code = generateReferralCode();
      const { data: existing } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("referral_code", code)
        .maybeSingle();
      if (!existing) referralCode = code;
    }

    console.log("✅ Generated referral code:", referralCode);

    // ✅ Activate user account
    const { error: activationError } = await supabaseAdmin
      .from("users")
      .update({
        is_active: true,
        referral_code: referralCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (activationError) {
      console.error("❌ Activation error:", activationError);
      return res.status(500).json({ error: "Failed to activate account" });
    }

    console.log("✅ Account activated:", userId);

    // ✅ Credit welcome bonus
    const { error: bonusError } = await supabaseAdmin.rpc("increment_wallet", {
      user_id_param: userId,
      amount_param: COMMISSION_CONFIG.WELCOME_BONUS,
    });

    if (bonusError) {
      console.error("❌ Welcome bonus error:", bonusError);
    } else {
      console.log("✅ Welcome bonus credited ₹" + COMMISSION_CONFIG.WELCOME_BONUS);
    }

    // ✅ Record welcome bonus in commissions table
    await supabaseAdmin.from("commissions").insert({
      user_id: userId,
      source_user_id: userId,
      amount: COMMISSION_CONFIG.WELCOME_BONUS,
      level: 0,
      payment_id: paymentRecord.id,
      commission_type: "welcome_bonus",
      status: "completed",
    });

    // ✅ Fetch referred_by to distribute commissions
    const { data: userRecord } = await supabaseAdmin
      .from("users")
      .select("referred_by")
      .eq("id", userId)
      .single();

    if (userRecord?.referred_by) {
      console.log("🌳 Processing referral commissions...");
      try {
        // ✅ FIX: Delete existing referral_tree rows before inserting (avoid 23505)
        await supabaseAdmin
          .from("referral_tree")
          .delete()
          .eq("user_id", userId);

        await buildReferralTree(userId, userRecord.referred_by);
        await distributeCommissions(
          userId,
          paymentRecord.id,
          COMMISSION_CONFIG.JOINING_FEE
        );
        console.log("✅ Referral tree built and commissions distributed");
      } catch (refErr) {
        // ⚠️ Don't fail the whole payment if commission fails
        console.error("❌ Referral commission error (non-fatal):", refErr.message);
      }
    } else {
      console.log("ℹ️ No referrer found, skipping commission distribution");
    }

    res.json({
      success: true,
      message: "Payment verified! Account activated.",
      referralCode,
      welcomeBonus: COMMISSION_CONFIG.WELCOME_BONUS,
      accountActivated: true,
    });
  } catch (error) {
    console.error("❌ Razorpay verification error:", error);
    res.status(500).json({
      error: "Payment verification failed",
      details: error.message,
    });
  }
});

/**
 * GET /api/payment/history
 */
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch payments" });
    }

    res.json({ payments: data || [] });
  } catch (error) {
    console.error("❌ Payment history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

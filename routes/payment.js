// routes/payment.js - REPLACE ENTIRE FILE
const express = require("express");
 
const crypto = require("crypto");
const Razorpay = require("razorpay");
 
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
 
// Razorpay configuration
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

/**
 * POST /api/payment/create-order
 * Create Razorpay payment order
 */
router.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name;
    const userEmail = req.user.email;
    const userPhone = req.user.phone;

    console.log("=== Creating Razorpay Payment Order ===");
    console.log("User:", { userId, userName, userEmail, userPhone });

    // Check if already paid
    const { data: existingPayment } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("user_id", userId)
      .eq("payment_type", "joining_fee")
      .eq("status", "completed")
      .single();

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

    // Razorpay order options (amount in paise)
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
    console.log("✅ Razorpay order created:", razorpayOrder);

    // Save to database
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: userId,
        amount: COMMISSION_CONFIG.JOINING_FEE,
        payment_type: "joining_fee",
        status: "pending",
        transaction_id: orderId, // internal reference
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

    console.log("✅ Payment order created successfully (DB record)");

    // Send data to frontend for Checkout
    res.json({
      success: true,
      orderId: orderId, // internal
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
 * Verify Razorpay payment and activate account
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
    console.log("Order ID (internal):", orderId);
    console.log("User ID:", userId);
    console.log("Razorpay:", {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    // Verify signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET_KEY)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      console.error("❌ Signature verification failed");
      return res.status(400).json({ error: "Payment verification failed" });
    }

    console.log("✅ Razorpay signature verified");

    // Update payment record
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

    if (paymentError) {
      console.error("❌ Payment update error:", paymentError);
      return res.status(500).json({ error: "Failed to update payment" });
    }

    console.log("✅ Payment record updated");

    // Generate unique referral code
    let referralCode = null;
    let codeExists = true;

    while (codeExists) {
      referralCode = generateReferralCode();
      const { data } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("referral_code", referralCode)
        .single();
      codeExists = !!data;
    }

    console.log("✅ Generated referral code:", referralCode);

    // Activate account & Set referral code
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

    console.log("✅ Account activated with referral code:", referralCode);

    // Credit welcome bonus
    const { error: bonusError } = await supabaseAdmin.rpc("increment_wallet", {
      user_id_param: userId,
      amount_param: COMMISSION_CONFIG.WELCOME_BONUS,
    });

    if (bonusError) {
      console.error("❌ Bonus credit error:", bonusError);
    } else {
      console.log(
        "✅ Welcome bonus credited: ₹" + COMMISSION_CONFIG.WELCOME_BONUS,
      );
    }

    // Build referral tree and distribute commissions
 
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
 
      await buildReferralTree(userId, user.referred_by);
      await distributeCommissions(
        userId,
        paymentRecord.id,
        COMMISSION_CONFIG.JOINING_FEE,
      );

      console.log("✅ Referral tree built and commissions distributed");
 
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
 * Get payment history
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

    res.json({ payments: data });
  } catch (error) {
    console.error("❌ Payment history error:", error);
    res.status(500).json({ error: "Internal server error" });
 
  }
});

module.exports = router;

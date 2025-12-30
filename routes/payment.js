// routes/payment.js
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const { supabaseAdmin } = require("../config/supabase");
const { authenticateToken } = require("../middleware/auth");
const {
  buildReferralTree,
  distributeCommissions,
} = require("../services/commissionService");
const COMMISSION_CONFIG = require("../config/commissionConfig");
const { generateReferralCode } = require("../utils/helpers");

const router = express.Router();

// Cashfree configuration
const CASHFREE_CONFIG = {
  appId: process.env.CASHFREE_APP_ID,
  secretKey: process.env.CASHFREE_SECRET_KEY,
  environment:
    process.env.CASHFREE_ENVIRONMENT === "PRODUCTION"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg",
};

// Create Cashfree order
async function createCashfreeOrder(orderData) {
  try {
    console.log("📞 Calling Cashfree API...");
    const response = await axios.post(
      `${CASHFREE_CONFIG.environment}/orders`,
      orderData,
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-version": "2023-08-01",
          "x-client-id": CASHFREE_CONFIG.appId,
          "x-client-secret": CASHFREE_CONFIG.secretKey,
        },
      }
    );
    console.log("✅ Cashfree order created successfully");
    return response.data;
  } catch (error) {
    console.error(
      "❌ Cashfree API error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Get order status
async function getOrderStatus(orderId) {
  try {
    console.log("🔍 Fetching order status from Cashfree...");
    const response = await axios.get(
      `${CASHFREE_CONFIG.environment}/orders/${orderId}/payments`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-version": "2023-08-01",
          "x-client-id": CASHFREE_CONFIG.appId,
          "x-client-secret": CASHFREE_CONFIG.secretKey,
        },
      }
    );
    console.log("✅ Order status fetched");
    return response.data;
  } catch (error) {
    console.error(
      "❌ Order status error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * POST /api/payment/create-order
 * Create payment order
 */
router.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name;
    const userEmail = req.user.email;
    const userPhone = req.user.phone;

    console.log("=== Creating Payment Order ===");
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
    if (!process.env.FRONTEND_URL || !process.env.BACKEND_URL) {
      console.error("❌ Missing environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const orderId = `ORDER_${Date.now()}_${userId.substring(0, 8)}`;

    // Clean phone number
    let cleanPhone = userPhone.replace(/\D/g, "");
    if (cleanPhone.length > 10) {
      cleanPhone = cleanPhone.slice(-10);
    }

    // Find the orderRequest section and update it:

    const orderRequest = {
      order_id: orderId,
      order_amount: COMMISSION_CONFIG.JOINING_FEE, // Now ₹295
      order_currency: "INR",
      customer_details: {
        customer_id: userId.substring(0, 20),
        customer_name: userName.substring(0, 50),
        customer_email: userEmail,
        customer_phone: cleanPhone,
      },
      order_meta: {
        return_url: `https://vk-marketing.netlify.app/payment-success.html?order_id=${orderId}`,
        notify_url: `https://a1-business-hub-backend.onrender.com/api/payment/webhook`,
      },
    };

    console.log("📦 Order Request:", JSON.stringify(orderRequest, null, 2));

    const cashfreeResponse = await createCashfreeOrder(orderRequest);

    // Save to database
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: userId,
        amount: COMMISSION_CONFIG.JOINING_FEE,
        payment_type: "joining_fee",
        status: "pending",
        transaction_id: orderId,
        metadata: {
          cashfree_order_id: orderId,
          payment_session_id: cashfreeResponse.payment_session_id,
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
      paymentSessionId: cashfreeResponse.payment_session_id,
      orderAmount: COMMISSION_CONFIG.JOINING_FEE,
      orderCurrency: "INR",
    });
  } catch (error) {
    console.error("❌ Create order error:", error);
    res.status(500).json({
      error: "Failed to create order",
      details: error.message,
    });
  }
});

/**
 * POST /api/payment/verify-payment
 * Verify payment and activate account
 */
router.post("/verify-payment", authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.user.id;

    if (!orderId) {
      return res.status(400).json({ error: "Order ID required" });
    }

    console.log("=== Payment Verification ===");
    console.log("Order ID:", orderId);
    console.log("User ID:", userId);

    // Get order status from Cashfree
    const orderStatus = await getOrderStatus(orderId);
    console.log("📊 Order status:", orderStatus);

    if (!orderStatus || orderStatus.length === 0) {
      return res.status(400).json({ error: "No payment found for this order" });
    }

    const payment = orderStatus[0];

    if (payment.payment_status !== "SUCCESS") {
      return res.status(400).json({
        error: "Payment not successful",
        status: payment.payment_status,
      });
    }

    // Update payment record
    const { data: paymentRecord, error: paymentError } = await supabaseAdmin
      .from("payments")
      .update({
        status: "completed",
        metadata: {
          cashfree_payment_id: payment.cf_payment_id,
          payment_time: payment.payment_time,
          payment_method: payment.payment_group,
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
        "✅ Welcome bonus credited: ₹" + COMMISSION_CONFIG.WELCOME_BONUS
      );
    }

    // Build referral tree and distribute commissions
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("referred_by")
      .eq("id", userId)
      .single();

    if (user?.referred_by) {
      console.log("✅ Building referral tree for referrer:", user.referred_by);

      await buildReferralTree(userId, user.referred_by);
      await distributeCommissions(
        userId,
        paymentRecord.id,
        COMMISSION_CONFIG.JOINING_FEE
      );

      console.log("✅ Referral tree built and commissions distributed");
    }

    res.json({
      success: true,
      message: "Payment verified successfully! Account activated.",
      referralCode: referralCode,
      welcomeBonus: COMMISSION_CONFIG.WELCOME_BONUS,
      accountActivated: true,
    });
  } catch (error) {
    console.error("❌ Verification error:", error);
    res.status(500).json({
      error: "Payment verification failed",
      details: error.message,
    });
  }
});

/**
 * POST /api/payment/webhook
 * Cashfree webhook
 */
router.post("/webhook", express.json(), async (req, res) => {
  try {
    console.log("🔔 Webhook received:", req.body);
    const webhookData = req.body;

    if (webhookData.type === "PAYMENT_SUCCESS_WEBHOOK") {
      const orderId = webhookData.data.order.order_id;

      await supabaseAdmin
        .from("payments")
        .update({ status: "completed" })
        .eq("transaction_id", orderId);

      console.log("✅ Webhook processed for order:", orderId);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).json({ error: "Webhook failed" });
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

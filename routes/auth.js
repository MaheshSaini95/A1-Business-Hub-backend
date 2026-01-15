// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");
const { buildReferralTree } = require("../services/commissionService");
const { sendResetOTP, sendWelcomeEmail } = require("../utils/emailService");

const router = express.Router();

// TEMP: Dummy mail sender - yaha actual email service integrate karna hai
async function sendResetEmail(to, otp) {
  console.log(`📧 SEND RESET OTP to ${to}: ${otp}`);
  // TODO: Integrate real mail service (SendGrid, Mailgun, etc.)
}

/**
 * Helper: generate JWT
 */
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
}

/**
 * POST /api/auth/forgot-password
 * Send OTP to user's email
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check if user exists
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, name, email, is_active")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (userError || !user) {
      return res
        .status(404)
        .json({ error: "No account found with this email" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Expires in 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Insert OTP record
    const { error: otpError } = await supabaseAdmin
      .from("password_resets")
      .insert({
        user_id: user.id,
        email: user.email,
        otp,
        expires_at: expiresAt,
      });

    if (otpError) {
      console.error("❌ OTP insert error:", otpError);
      return res.status(500).json({ error: "Failed to generate OTP" });
    }

    // ✅ Send OTP via email
    try {
      await sendResetOTP(user.email, otp, user.name);
      console.log(`✅ Password reset OTP sent to ${user.email}: ${otp}`);
    } catch (emailError) {
      console.error("❌ Email send failed:", emailError);
      return res.status(500).json({ error: "Failed to send OTP email" });
    }

    res.json({
      success: true,
      message: "OTP sent to your email. Please check inbox/spam folder.",
    });
  } catch (err) {
    console.error("❌ Forgot password error:", err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using OTP
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        error: "Email, OTP and new password are required",
      });
    }

    // Validate password strength
    if (newPassword.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters",
      });
    }

    // Find valid OTP
    const { data: resetRecord, error: resetError } = await supabaseAdmin
      .from("password_resets")
      .select("id, user_id, email, otp, expires_at, used")
      .eq("email", email.trim().toLowerCase())
      .eq("otp", otp.trim())
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resetError || !resetRecord) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Check expiry
    if (new Date(resetRecord.expires_at) < new Date()) {
      return res
        .status(400)
        .json({ error: "OTP expired. Please request a new one." });
    }

    // Hash new password
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password_hash: hashedPassword })
      .eq("id", resetRecord.user_id);

    if (updateError) {
      console.error("❌ Password update error:", updateError);
      return res.status(500).json({ error: "Failed to update password" });
    }

    // Mark OTP as used
    await supabaseAdmin
      .from("password_resets")
      .update({ used: true })
      .eq("id", resetRecord.id);

    console.log(`✅ Password reset successful for user ${resetRecord.user_id}`);

    res.json({
      success: true,
      message:
        "Password reset successful! Please login with your new password.",
    });
  } catch (err) {
    console.error("❌ Reset password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});
router.post("/register", async (req, res) => {
  try {
    let { name, email, phone, password, referralCode } = req.body;

    console.log("=== Registration Attempt ===");
    console.log("Input:", { name, email, phone, referralCode });

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Clean phone
    phone = phone.replace(/\D/g, "");
    if (phone.length > 10) phone = phone.slice(-10);
    if (phone.length !== 10) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    // Check existing email
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Referral handling
    let referredByUUID = null;
    if (referralCode && referralCode.trim()) {
      const { data: referrer, error: refError } = await supabaseAdmin
        .from("users")
        .select("id, is_active, referral_code")
        .eq("referral_code", referralCode.trim().toUpperCase())
        .maybeSingle();

      if (refError || !referrer) {
        return res.status(400).json({ error: "Invalid referral code" });
      }

      if (!referrer.is_active) {
        return res
          .status(400)
          .json({ error: "Referrer account is not active" });
      }

      referredByUUID = referrer.id;
      console.log("✅ Valid referrer found:", {
        code: referrer.referral_code,
        uuid: referrer.id,
      });
    }

    // Create user
    const userData = {
      name: name.trim().substring(0, 100),
      email: email.trim().toLowerCase().substring(0, 255),
      phone,
      password_hash: hashedPassword,
      referred_by: referredByUUID,
      is_active: false,
      wallet_balance: 0,
      total_earnings: 0,
      total_withdrawn: 0,
      is_admin: false,
    };

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .insert(userData)
      .select()
      .single();

    if (userError) {
      console.error("❌ User creation error:", userError);
      return res.status(500).json({
        error: "Registration failed",
        details: userError.message,
        code: userError.code,
      });
    }

    console.log("✅ User created:", user.id);

    // ✅ BUILD REFERRAL TREE (if referred)
    if (referredByUUID) {
      try {
        console.log(`🌳 Building referral tree for ${user.id}...`);
        await buildReferralTree(user.id, referredByUUID);
      } catch (treeError) {
        console.error("❌ buildReferralTree error:", treeError);
        // Don't fail registration, just log
      }
    }

    const token = signToken({ userId: user.id, email: user.email });

    res.status(201).json({
      success: true,
      message: "Registration successful! Complete payment to activate.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.is_active,
        isAdmin: !!user.is_admin,
      },
      needsPayment: !user.is_active,
    });
  } catch (error) {
    console.error("❌ Registration error:", error);
    res.status(500).json({
      error: "Registration failed",
      details: error.message,
    });
  }
});

/**
 * POST /api/auth/login
 * Normal user login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("=== Login Attempt ===", email);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken({ userId: user.id, email: user.email });

    console.log("✅ Login successful");

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.is_active,
        isAdmin: !!user.is_admin,
        needsPayment: !user.is_active,
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/admin-login
 * Admin login with secret code + password
 */
router.post("/admin-login", async (req, res) => {
  try {
    const { email, password, secretCode } = req.body;

    console.log("=== Admin Login Attempt ===", {
      email,
      hasPassword: !!password,
      hasSecret: !!secretCode,
    });

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@a1businesshub.com";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Vk@2026";
    const ADMIN_SECRET_CODE = process.env.ADMIN_SECRET_CODE || "A1ADMIN2024";

    console.log("Expected:", {
      ADMIN_EMAIL,
      ADMIN_SECRET_CODE: `****${ADMIN_SECRET_CODE.slice(-4)}`,
    });

    // 1. Email check
    if (email !== ADMIN_EMAIL) {
      console.log("❌ Email mismatch");
      return res.status(401).json({ error: "Invalid email" });
    }

    // 2. Password check
    if (password !== ADMIN_PASSWORD) {
      console.log("❌ Password mismatch");
      return res.status(401).json({ error: "Invalid password" });
    }

    // 3. Secret code check
    if (secretCode !== ADMIN_SECRET_CODE) {
      console.log("❌ Secret code mismatch");
      return res.status(401).json({ error: "Invalid secret code" });
    }

    const token = jwt.sign(
      {
        userId: "ADMIN_SYSTEM",
        email: ADMIN_EMAIL,
        isAdmin: true,
        admin: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    console.log("✅ Admin login successful");
    res.json({
      success: true,
      token,
      user: {
        id: "ADMIN_SYSTEM",
        name: "Admin Panel",
        email: ADMIN_EMAIL,
        isAdmin: true,
        admin: true,
      },
    });
  } catch (error) {
    console.error("❌ Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;

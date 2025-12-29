// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

/**
 * POST /api/auth/register
 */
router.post("/register", async (req, res) => {
  try {
    let { name, email, phone, password, referralCode } = req.body;

    console.log("=== Registration Attempt ===");
    console.log("Input:", { name, email, phone, referralCode });

    // Validate
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
      .single();

    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ FIX: Match referral_code but store referrer's UUID in referred_by
    let referredByUUID = null;
    if (referralCode && referralCode.trim()) {
      const { data: referrer, error: refError } = await supabaseAdmin
        .from("users")
        .select("id, is_active, referral_code")
        .eq("referral_code", referralCode.trim().toUpperCase())
        .single();

      if (refError || !referrer) {
        return res.status(400).json({ error: "Invalid referral code" });
      }

      if (!referrer.is_active) {
        return res.status(400).json({
          error: "Referrer account is not active",
        });
      }

      referredByUUID = referrer.id; // Store UUID, not referral_code!
      console.log("✅ Valid referrer found:", {
        code: referrer.referral_code,
        uuid: referrer.id,
      });
    }

    // Create user
    const userData = {
      name: name.trim().substring(0, 100),
      email: email.trim().toLowerCase().substring(0, 255),
      phone: phone,
      password_hash: hashedPassword,
      referred_by: referredByUUID, // UUID or NULL
      is_active: false,
      wallet_balance: 0,
      total_earnings: 0,
      total_withdrawn: 0,
    };

    console.log("Creating user with:", {
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      referred_by: userData.referred_by || "NULL",
    });

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

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(201).json({
      success: true,
      message: "Registration successful! Complete payment to activate.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: false,
      },
      needsPayment: true,
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
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log("=== Login Attempt ===", email);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Get user
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    console.log("✅ Login successful");

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.is_active,
        needsPayment: !user.is_active,
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;

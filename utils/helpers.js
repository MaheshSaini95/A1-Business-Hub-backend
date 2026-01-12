// utils/helpers.js
function generateReferralCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function ensureUniqueReferralCode() {
  const { supabaseAdmin } = require("../config/supabase");

  for (let i = 0; i < 10; i++) {
    const code = generateReferralCode();
    const { data } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();

    if (!data) return code;
  }
  throw new Error("Could not generate unique code");
}

module.exports = { generateReferralCode, ensureUniqueReferralCode };

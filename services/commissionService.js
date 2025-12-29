// services/commissionService.js
const { supabaseAdmin } = require("../config/supabase");
const COMMISSION_CONFIG = require("../config/commissionConfig");

/**
 * Build referral tree when user pays (not registers)
 * @param {string} userId - New user's UUID
 * @param {string} referredByUserId - Sponsor's UUID (not referral code!)
 */
async function buildReferralTree(userId, referredByUserId) {
  try {
    if (!referredByUserId) {
      console.log("❌ No referrer provided");
      return;
    }

    console.log("=== Building Referral Tree ===");
    console.log("New User ID:", userId);
    console.log("Referrer UUID:", referredByUserId);

    // ✅ FIX: Get sponsor by UUID, not referral_code
    const { data: sponsor, error: sponsorError } = await supabaseAdmin
      .from("users")
      .select("id, referral_code, name")
      .eq("id", referredByUserId) // ✅ Changed from referral_code to id
      .single();

    if (sponsorError || !sponsor) {
      console.error("❌ Sponsor not found:", sponsorError);
      return;
    }

    console.log("✅ Sponsor found:", sponsor.name, sponsor.referral_code);

    // Get sponsor's ancestors (up to level 9)
    const { data: sponsorAncestors } = await supabaseAdmin
      .from("referral_tree")
      .select("*")
      .eq("user_id", sponsor.id)
      .lte("level", COMMISSION_CONFIG.MAX_LEVELS - 1);

    console.log(`Found ${sponsorAncestors?.length || 0} ancestors of sponsor`);

    // Insert direct sponsor (level 1)
    const { error: level1Error } = await supabaseAdmin
      .from("referral_tree")
      .insert({
        user_id: userId,
        ancestor_id: sponsor.id,
        level: 1,
      });

    if (level1Error) {
      console.error("❌ Error inserting level 1:", level1Error);
      return;
    }

    console.log("✅ Inserted level 1 relationship");

    // Insert all other ancestors with incremented levels
    if (sponsorAncestors && sponsorAncestors.length > 0) {
      const ancestorRecords = sponsorAncestors.map((ancestor) => ({
        user_id: userId,
        ancestor_id: ancestor.ancestor_id,
        level: ancestor.level + 1,
      }));

      const { error: ancestorsError } = await supabaseAdmin
        .from("referral_tree")
        .insert(ancestorRecords);

      if (ancestorsError) {
        console.error("❌ Error inserting ancestors:", ancestorsError);
      } else {
        console.log(`✅ Inserted ${ancestorRecords.length} ancestor records`);
      }
    }

    console.log(`✅ Referral tree built successfully for user ${userId}`);
  } catch (error) {
    console.error("❌ Error building referral tree:", error);
    throw error;
  }
}

/**
 * Distribute commissions when a new user pays joining fee
 * @param {string} newUserId - UUID of new user who paid
 * @param {string} paymentId - Payment record ID
 * @param {number} joiningAmount - Amount paid (250)
 */
async function distributeCommissions(newUserId, paymentId, joiningAmount) {
  try {
    console.log("=== Distributing Commissions ===");
    console.log("New User:", newUserId);
    console.log("Payment ID:", paymentId);
    console.log("Amount:", joiningAmount);

    // Get all ancestors of the new user from referral_tree
    const { data: ancestors, error } = await supabaseAdmin
      .from("referral_tree")
      .select(
        `
        ancestor_id,
        level,
        users:ancestor_id (id, referral_code, name, is_active)
      `
      )
      .eq("user_id", newUserId)
      .lte("level", COMMISSION_CONFIG.MAX_LEVELS)
      .order("level", { ascending: true });

    if (error) {
      console.error("❌ Error fetching ancestors:", error);
      return;
    }

    if (!ancestors || ancestors.length === 0) {
      console.log("❌ No ancestors found in referral tree");
      return;
    }

    console.log(`✅ Found ${ancestors.length} ancestors`);

    const commissionRecords = [];
    const walletUpdates = [];

    for (const ancestor of ancestors) {
      const level = ancestor.level;
      const ancestorUser = ancestor.users;

      // Skip if user is not active
      if (!ancestorUser || !ancestorUser.is_active) {
        console.log(`⚠️ Skipping level ${level} - User not active`);
        continue;
      }

      const config = COMMISSION_CONFIG.LEVEL_COMMISSIONS[level];

      if (!config) {
        console.log(`⚠️ No commission config for level ${level}`);
        continue;
      }

      // Calculate commission amount
      const commissionAmount = Math.min(
        (joiningAmount * config.percentage) / 100,
        config.maxAmount
      );

      console.log(
        `✅ Level ${level}: ${ancestorUser.name} gets ₹${commissionAmount}`
      );

      // Prepare commission record
      commissionRecords.push({
        user_id: ancestor.ancestor_id,
        source_user_id: newUserId,
        level: level,
        amount: commissionAmount,
        commission_type: level === 1 ? "referral" : "level_income",
        status: "credited",
        payment_id: paymentId,
      });

      // Prepare wallet update
      walletUpdates.push({
        userId: ancestor.ancestor_id,
        amount: commissionAmount,
      });
    }

    // Insert all commissions in one go
    if (commissionRecords.length > 0) {
      const { error: commissionError } = await supabaseAdmin
        .from("commissions")
        .insert(commissionRecords);

      if (commissionError) {
        console.error("❌ Error inserting commissions:", commissionError);
        return;
      }

      console.log(`✅ Inserted ${commissionRecords.length} commission records`);

      // Update all wallets
      for (const update of walletUpdates) {
        const { error: walletError } = await supabaseAdmin.rpc(
          "increment_wallet",
          {
            user_id_param: update.userId,
            amount_param: update.amount,
          }
        );

        if (walletError) {
          console.error("❌ Wallet update error:", walletError);
        } else {
          console.log(`✅ Wallet updated: ${update.userId} +₹${update.amount}`);
        }
      }

      console.log(
        `✅ Distributed ${commissionRecords.length} commissions successfully`
      );
    } else {
      console.log("❌ No commissions to distribute");
    }

    return commissionRecords;
  } catch (error) {
    console.error("❌ Error distributing commissions:", error);
    throw error;
  }
}

module.exports = {
  buildReferralTree,
  distributeCommissions,
};

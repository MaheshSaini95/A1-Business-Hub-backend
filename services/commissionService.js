// services/commissionService.js

const { supabaseAdmin } = require("../config/supabase");
const COMMISSION_CONFIG = require("../config/commissionConfig");

/**
 * Build referral tree up to 5 levels
 */
async function buildReferralTree(newUserId, referrerId) {
  try {
    console.log(`🌳 Building referral tree for user: ${newUserId}`);

    let currentReferrerId = referrerId;
    let level = 1;
    const relationships = [];

    while (
      currentReferrerId &&
      level <= COMMISSION_CONFIG.MAX_COMMISSION_LEVEL
    ) {
      console.log(
        `  Level ${level}: Adding relationship to ${currentReferrerId}`
      );

      relationships.push({
        user_id: newUserId,
        referrer_id: currentReferrerId,
        level: level,
      });

      // Get next level referrer
      const { data: referrer } = await supabaseAdmin
        .from("users")
        .select("referred_by")
        .eq("id", currentReferrerId)
        .single();

      currentReferrerId = referrer?.referred_by;
      level++;
    }

    // Insert all relationships at once
    if (relationships.length > 0) {
      const { error } = await supabaseAdmin
        .from("referral_tree")
        .insert(relationships);

      if (error) {
        console.error("❌ Error building referral tree:", error);
        throw error;
      }

      console.log(`✅ Referral tree built: ${relationships.length} levels`);
    }

    return relationships.length;
  } catch (error) {
    console.error("❌ buildReferralTree error:", error);
    throw error;
  }
}

/**
 * Distribute commissions to upline (5 levels, unlimited width)
 */
async function distributeCommissions(newUserId, paymentId, joiningFee) {
  try {
    console.log(`💰 Distributing commissions for user: ${newUserId}`);

    // Get all upline members (up to 5 levels)
    const { data: uplineMembers, error: treeError } = await supabaseAdmin
      .from("referral_tree")
      .select("referrer_id, level")
      .eq("user_id", newUserId)
      .lte("level", COMMISSION_CONFIG.MAX_COMMISSION_LEVEL)
      .order("level", { ascending: true });

    if (treeError) {
      console.error("❌ Error fetching upline:", treeError);
      return;
    }

    if (!uplineMembers || uplineMembers.length === 0) {
      console.log("⚠️ No upline members found");
      return;
    }

    console.log(`📊 Found ${uplineMembers.length} upline members`);

    const commissions = [];

    for (const member of uplineMembers) {
      const level = member.level;
      const commissionData = COMMISSION_CONFIG.COMMISSION_RATES[level];

      if (!commissionData) continue;

      const commissionAmount = commissionData.amount;

      console.log(
        `  Level ${level} → ₹${commissionAmount} to ${member.referrer_id}`
      );

      // Credit wallet
      const { error: walletError } = await supabaseAdmin.rpc(
        "increment_wallet",
        {
          user_id_param: member.referrer_id,
          amount_param: commissionAmount,
        }
      );

      if (walletError) {
        console.error(
          `❌ Wallet error for ${member.referrer_id}:`,
          walletError
        );
        continue;
      }

      // Record commission
      commissions.push({
        user_id: member.referrer_id,
        source_user_id: newUserId,
        amount: commissionAmount,
        level: level,
        payment_id: paymentId,
        commission_type: "referral_commission",
        status: "completed",
      });
    }

    // Insert all commissions
    if (commissions.length > 0) {
      const { error: commissionError } = await supabaseAdmin
        .from("commissions")
        .insert(commissions);

      if (commissionError) {
        console.error("❌ Error recording commissions:", commissionError);
      } else {
        console.log(
          `✅ ${commissions.length} commissions distributed successfully`
        );
      }
    }

    // Check and distribute rewards
    await checkAndDistributeRewards(uplineMembers.map((m) => m.referrer_id));
  } catch (error) {
    console.error("❌ distributeCommissions error:", error);
  }
}

/**
 * Check and distribute rewards based on team milestones
 */
async function checkAndDistributeRewards(userIds) {
  try {
    for (const userId of userIds) {
      // Check Level 1 rewards (Direct referrals)
      await checkLevel1Rewards(userId);

      // Check Level 2 rewards (Indirect referrals)
      await checkLevel2Rewards(userId);
    }
  } catch (error) {
    console.error("❌ checkAndDistributeRewards error:", error);
  }
}

/**
 * Check Level 1 (Direct) rewards
 */
async function checkLevel1Rewards(userId) {
  try {
    // Count direct active referrals
    const { count: directCount } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("level", 1);

    if (!directCount) return;

    // Get already claimed rewards
    const { data: claimedRewards } = await supabaseAdmin
      .from("rewards")
      .select("milestone_teams")
      .eq("user_id", userId)
      .eq("level", 1);

    const claimedTeams = claimedRewards?.map((r) => r.milestone_teams) || [];

    // Check each milestone
    for (const milestone of COMMISSION_CONFIG.REWARDS.LEVEL_1) {
      if (
        directCount >= milestone.teams &&
        !claimedTeams.includes(milestone.teams)
      ) {
        console.log(
          `🎁 Rewarding ${userId}: Level 1, ${milestone.teams} teams → ₹${milestone.reward}`
        );

        // Credit reward
        await supabaseAdmin.rpc("increment_wallet", {
          user_id_param: userId,
          amount_param: milestone.reward,
        });

        // Record reward
        await supabaseAdmin.from("rewards").insert({
          user_id: userId,
          level: 1,
          milestone_teams: milestone.teams,
          reward_amount: milestone.reward,
          reward_title: milestone.title,
        });
      }
    }
  } catch (error) {
    console.error("❌ checkLevel1Rewards error:", error);
  }
}

/**
 * Check Level 2 (Indirect) rewards
 */
async function checkLevel2Rewards(userId) {
  try {
    // Count level 2 active referrals
    const { count: level2Count } = await supabaseAdmin
      .from("referral_tree")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("level", 2);

    if (!level2Count) return;

    // Get already claimed rewards
    const { data: claimedRewards } = await supabaseAdmin
      .from("rewards")
      .select("milestone_teams")
      .eq("user_id", userId)
      .eq("level", 2);

    const claimedTeams = claimedRewards?.map((r) => r.milestone_teams) || [];

    // Check each milestone
    for (const milestone of COMMISSION_CONFIG.REWARDS.LEVEL_2) {
      if (
        level2Count >= milestone.teams &&
        !claimedTeams.includes(milestone.teams)
      ) {
        console.log(
          `🎁 Rewarding ${userId}: Level 2, ${milestone.teams} teams → ₹${milestone.reward}`
        );

        // Credit reward
        await supabaseAdmin.rpc("increment_wallet", {
          user_id_param: userId,
          amount_param: milestone.reward,
        });

        // Record reward
        await supabaseAdmin.from("rewards").insert({
          user_id: userId,
          level: 2,
          milestone_teams: milestone.teams,
          reward_amount: milestone.reward,
          reward_title: milestone.title,
        });
      }
    }
  } catch (error) {
    console.error("❌ checkLevel2Rewards error:", error);
  }
}

module.exports = {
  buildReferralTree,
  distributeCommissions,
  checkAndDistributeRewards,
};

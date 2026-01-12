// services/commissionService.js
const { supabaseAdmin } = require("../config/supabase");
const COMMISSION_CONFIG = require("../config/commissionConfig");

/**
 * Build referral tree for new user (up to 10 levels)
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
      console.log(`  Level ${level}: Adding to ${currentReferrerId}`);

      relationships.push({
        user_id: newUserId,
        referrer_id: currentReferrerId,
        level,
      });

      const { data: referrer } = await supabaseAdmin
        .from("users")
        .select("referred_by")
        .eq("id", currentReferrerId)
        .single();

      currentReferrerId = referrer?.referred_by || null;
      level++;
    }

    if (relationships.length > 0) {
      const { error } = await supabaseAdmin
        .from("referral_tree")
        .insert(relationships);

      if (error) {
        console.error("❌ Referral tree insert error:", error);
        throw error;
      }

      console.log(`✅ Referral tree built: ${relationships.length} levels`);
      return relationships.length;
    }

    console.log("⚠️ No relationships to build");
    return 0;
  } catch (error) {
    console.error("❌ buildReferralTree error:", error);
    throw error;
  }
}

/**
 * Distribute commissions to upline (10 levels)
 */
async function distributeCommissions(newUserId, paymentId, joiningFee) {
  try {
    console.log(`💰 Distributing commissions for user: ${newUserId}`);

    const { data: uplineMembers, error: treeError } = await supabaseAdmin
      .from("referral_tree")
      .select("referrer_id, level")
      .eq("user_id", newUserId)
      .lte("level", COMMISSION_CONFIG.MAX_COMMISSION_LEVEL)
      .order("level", { ascending: true });

    if (treeError) {
      console.error("❌ Upline fetch error:", treeError);
      return;
    }

    if (!uplineMembers || uplineMembers.length === 0) {
      console.log("⚠️ No upline members found (check referral_tree)");
      return;
    }

    console.log(`📊 Found ${uplineMembers.length} upline members`);

    const commissions = [];

    for (const member of uplineMembers) {
      const level = member.level;
      const commissionConfig = COMMISSION_CONFIG.COMMISSION_RATES[level];

      if (!commissionConfig) {
        console.log(`⚠️ No config for level ${level}, skipping`);
        continue;
      }

      const commissionAmount = commissionConfig.amount;
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
        console.error(`❌ Wallet error level ${level}:`, walletError);
        continue;
      }

      // Record commission
      commissions.push({
        user_id: member.referrer_id,
        source_user_id: newUserId,
        amount: commissionAmount,
        level,
        payment_id: paymentId,
        commission_type: "referral_commission",
        status: "completed",
      });
    }

    if (commissions.length > 0) {
      const { error: commissionError } = await supabaseAdmin
        .from("commissions")
        .insert(commissions);

      if (commissionError) {
        console.error("❌ Commissions insert error:", commissionError);
      } else {
        console.log(`✅ ${commissions.length} commissions inserted!`);
      }
    }

    // ✅ Check rewards for all upline members
    await checkAndDistributeRewards(uplineMembers.map((m) => m.referrer_id));
  } catch (error) {
    console.error("❌ distributeCommissions error:", error);
    throw error;
  }
}

/**
 * Check and distribute rewards for all 10 levels
 */
async function checkAndDistributeRewards(userIds) {
  try {
    console.log(`🎁 Checking rewards for ${userIds.length} users...`);

    for (const userId of userIds) {
      // Check rewards for all 10 levels
      for (let level = 1; level <= 10; level++) {
        await checkLevelRewards(userId, level);
      }
    }
  } catch (error) {
    console.error("❌ checkAndDistributeRewards error:", error);
  }
}

/**
 * Check rewards for specific level (1-10)
 */
async function checkLevelRewards(userId, level) {
  try {
    // Count ACTIVE referrals at this level
    const { data: teamMembers, error: countError } = await supabaseAdmin
      .from("referral_tree")
      .select(
        `
        user_id,
        users!referral_tree_user_id_fkey (is_active)
      `
      )
      .eq("referrer_id", userId)
      .eq("level", level);

    if (countError) {
      console.error(`❌ Level ${level} count error:`, countError);
      return;
    }

    // Count only ACTIVE users (is_active = true)
    const activeCount =
      teamMembers?.filter((m) => m.users?.is_active === true).length || 0;

    if (activeCount === 0) {
      return; // No active teams at this level
    }

    console.log(`  Level ${level}: ${activeCount} active teams`);

    // Get already claimed rewards
    const { data: claimedRewards } = await supabaseAdmin
      .from("rewards")
      .select("milestone_teams")
      .eq("user_id", userId)
      .eq("level", level);

    const claimedTeams = claimedRewards?.map((r) => r.milestone_teams) || [];

    // Get milestones for this level
    const levelKey = `LEVEL_${level}`;
    const milestones = COMMISSION_CONFIG.REWARDS[levelKey] || [];

    if (milestones.length === 0) return;

    // Check each milestone
    for (const milestone of milestones) {
      if (
        activeCount >= milestone.teams &&
        !claimedTeams.includes(milestone.teams)
      ) {
        console.log(
          `🎁 REWARD UNLOCKED: Level ${level}, ${milestone.teams} teams → ₹${milestone.reward}`
        );

        // ✅ Credit wallet
        const { error: walletError } = await supabaseAdmin.rpc(
          "increment_wallet",
          {
            user_id_param: userId,
            amount_param: milestone.reward,
          }
        );

        if (walletError) {
          console.error(`❌ Reward wallet error:`, walletError);
          continue;
        }

        // ✅ Record reward with claimed_at timestamp
        const { error: rewardError } = await supabaseAdmin
          .from("rewards")
          .insert({
            user_id: userId,
            level,
            milestone_teams: milestone.teams,
            reward_amount: milestone.reward,
            reward_title: milestone.title,
            claimed_at: new Date().toISOString(), // ✅ Important for count
          });

        if (rewardError) {
          console.error(`❌ Reward insert error:`, rewardError);
        } else {
          console.log(`✅ Reward ₹${milestone.reward} credited to ${userId}`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Level ${level} rewards error:`, error);
  }
}

// ✅ EXPORTS
module.exports = {
  buildReferralTree,
  distributeCommissions,
  checkAndDistributeRewards,
};

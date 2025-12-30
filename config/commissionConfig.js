// config/commissionConfig.js

module.exports = {
  // Joining fee with GST
  JOINING_FEE_BASE: 250,
  GST_RATE: 0.18, // 18%
  JOINING_FEE: 295, // 250 + 18% = 295

  // Welcome bonus
  WELCOME_BONUS: 50,

  // Level-wise commission structure (unlimited referrals, 5 levels deep)
  COMMISSION_RATES: {
    1: { rate: 0.1, amount: 25 }, // 10% or ₹25
    2: { rate: 0.08, amount: 20 }, // 8% or ₹20
    3: { rate: 0.06, amount: 15 }, // 6% or ₹15
    4: { rate: 0.04, amount: 10 }, // 4% or ₹10
    5: { rate: 0.02, amount: 5 }, // 2% or ₹5
  },
  MAX_COMMISSION_LEVEL: 5,

  // Reward milestones
  REWARDS: {
    // Level 1 (Direct referrals)
    LEVEL_1: [{ teams: 5, reward: 50, title: "Starter - ₹50" }],

    // Level 2 (Indirect referrals)
    LEVEL_2: [{ teams: 25, reward: 200, title: "Level 2 - ₹200" }],
    LEVEL_3: [{ teams: 125, reward: 600, title: "Starter - ₹600" }],
    LEVEL_4: [{ teams: 750, reward: 3000, title: "Smart watch- ₹3000" }],
    LEVEL_5: [{ teams: 3750, reward: 15000, title: "Boat spkear - ₹15000" }],
    LEVEL_6: [{ teams: 18750, reward: 75000, title: "Smart mobik - ₹75000" }],
    LEVEL_7: [{ teams: 93150, reward: 375000, title: "manali tour - ₹375000" }],
    LEVEL_8: [{ teams: 468750, reward: 1875000, title: "goa tour - ₹1875000" }],
    LEVEL_9: [
      { teams: 2343750, reward: 9375000, title: "thailand tour - ₹9375000" },
    ],
    LEVEL_10: [
      {
        teams: 1178750,
        reward: 46875000,
        title: "Dubai tour + sport bike - ₹46875000",
      },
    ],
  },

  // Minimum withdrawal
  MIN_WITHDRAWAL: 100,
};

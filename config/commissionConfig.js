// config/commissionConfig.js

const COMMISSION_CONFIG = {
  JOINING_FEE: 250, // INR
  WELCOME_BONUS: 50, // INR credited on successful payment

  // Level-wise commission structure
  LEVEL_COMMISSIONS: {
    1: { percentage: 20, maxAmount: 50 }, // Direct referral
    2: { percentage: 10, maxAmount: 25 }, // Level 2
    3: { percentage: 6, maxAmount: 15 }, // Level 3
    4: { percentage: 6, maxAmount: 15 }, // Level 4
    5: { percentage: 4, maxAmount: 10 }, // Level 5
    6: { percentage: 2, maxAmount: 5 }, // Level 6
    7: { percentage: 2, maxAmount: 5 }, // Level 7
    8: { percentage: 2, maxAmount: 5 }, // Level 8
    9: { percentage: 2, maxAmount: 5 }, // Level 9
    10: { percentage: 2, maxAmount: 5 }, // Level 10
  },

  MAX_LEVELS: 10,
  MIN_WITHDRAWAL_AMOUNT: 500, // Minimum amount to withdraw
};

module.exports = COMMISSION_CONFIG;

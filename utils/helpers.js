// utils/helpers.js
function generateReferralCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateTransactionId() {
  return `TXN_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)
    .toUpperCase()}`;
}

module.exports = {
  generateReferralCode,
  generateTransactionId,
};

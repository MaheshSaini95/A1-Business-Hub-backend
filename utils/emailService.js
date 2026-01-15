// utils/emailService.js
const nodemailer = require("nodemailer");

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: "gmail", // या "smtp.gmail.com"
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail
    pass: process.env.EMAIL_PASSWORD, // App Password (not Gmail password)
  },
});

/**
 * Send Password Reset OTP Email
 */
async function sendResetOTP(toEmail, otp, userName = "User") {
  try {
    const mailOptions = {
      from: `"A1 Business Hub" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: "🔐 Password Reset OTP - A1 Business Hub",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f4f4f4;
              margin: 0;
              padding: 0;
            }
            .email-container {
              max-width: 600px;
              margin: 30px auto;
              background: #ffffff;
              border-radius: 12px;
              overflow: hidden;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
            }
            .content {
              padding: 40px 30px;
              text-align: center;
            }
            .otp-box {
              background: #f8f9fa;
              border: 2px dashed #667eea;
              border-radius: 8px;
              padding: 20px;
              margin: 30px 0;
              font-size: 36px;
              font-weight: bold;
              color: #667eea;
              letter-spacing: 8px;
            }
            .info-text {
              color: #64748b;
              font-size: 14px;
              line-height: 1.6;
              margin: 20px 0;
            }
            .warning {
              background: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
              text-align: left;
              font-size: 13px;
              color: #856404;
            }
            .footer {
              background: #f8f9fa;
              padding: 20px;
              text-align: center;
              color: #64748b;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h1>🔐 Password Reset</h1>
            </div>
            
            <div class="content">
              <p style="font-size: 16px; color: #334155;">
                Hello <strong>${userName}</strong>,
              </p>
              
              <p class="info-text">
                We received a request to reset your password. 
                Use the OTP below to complete the process:
              </p>
              
              <div class="otp-box">
                ${otp}
              </div>
              
              <p class="info-text">
                This OTP is valid for <strong>15 minutes</strong> only.
              </p>
              
              <div class="warning">
                ⚠️ <strong>Security Notice:</strong><br>
                • Do not share this OTP with anyone<br>
                • A1 Business Hub will never ask for your OTP via phone/WhatsApp<br>
                • If you didn't request this, please ignore this email
              </div>
            </div>
            
            <div class="footer">
              <p>© 2026 A1 Business Hub. All rights reserved.</p>
              <p>Need help? Contact: support@a1businesshub.com</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent:", info.messageId);
    return { success: true };
  } catch (error) {
    console.error("❌ Email send error:", error);
    throw new Error("Failed to send email");
  }
}

/**
 * Send Welcome Email (Optional - for new registrations)
 */
async function sendWelcomeEmail(toEmail, userName, referralCode) {
  try {
    const mailOptions = {
      from: `"A1 Business Hub" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: "🎉 Welcome to A1 Business Hub!",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px;">
            <h1 style="color: #667eea; text-align: center;">Welcome to A1 Business Hub! 🎉</h1>
            
            <p>Hi <strong>${userName}</strong>,</p>
            
            <p>Your account has been created successfully!</p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0;">Your Referral Code:</h3>
              <p style="font-size: 24px; font-weight: bold; color: #667eea; margin: 0;">
                ${referralCode}
              </p>
            </div>
            
            <p style="color: #64748b;">
              Complete your payment of ₹295 to activate your account and start earning!
            </p>
            
            <p style="text-align: center; margin-top: 30px;">
              <a href="https://a1hub.netlify.app/login.html" 
                 style="background: #667eea; color: white; padding: 12px 30px; 
                        text-decoration: none; border-radius: 8px; display: inline-block;">
                Login to Dashboard
              </a>
            </p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Welcome email sent to:", toEmail);
  } catch (error) {
    console.error("❌ Welcome email error:", error);
    // Don't throw - welcome email is not critical
  }
}

module.exports = {
  sendResetOTP,
  sendWelcomeEmail,
};

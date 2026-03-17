const mongoose = require('mongoose');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    googleId: String,
    name: String,
    picture: String,

    // WhatsApp fields
    whatsappNumber: { type: String, default: null },          // E.164 format: +919876543210
    whatsappVerified: { type: Boolean, default: false },
    whatsappNotificationsEnabled: { type: Boolean, default: true },

    // OTP fields (temporary, cleared after verification)
    whatsappOtp: { type: String, default: null },             // Hashed OTP
    whatsappOtpExpiry: { type: Date, default: null },
    whatsappOtpAttempts: { type: Number, default: 0 },
    whatsappOtpLastSent: { type: Date, default: null },
    whatsappPendingNumber: { type: String, default: null },   // Unverified new number (staged during re-verification)

    // Notification tracking
    lastWhatsappNotification: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});

// Hash OTP before storing. pendingNumber is the number being verified.
userSchema.methods.setOtp = function (otp, pendingNumber) {
    this.whatsappOtp = crypto.createHash('sha256').update(otp).digest('hex');
    this.whatsappOtpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    this.whatsappOtpAttempts = 0;
    this.whatsappOtpLastSent = new Date(); // Set atomically with OTP
    if (pendingNumber) {
        this.whatsappPendingNumber = pendingNumber; // Stage new number separately
    }
};

// Verify OTP
userSchema.methods.verifyOtp = function (otp) {
    const otpStr = String(otp).trim(); // Coerce to string — handles numeric inputs
    if (!this.whatsappOtp || !this.whatsappOtpExpiry) {
        return { valid: false, reason: 'No OTP requested' };
    }
    if (this.whatsappOtpAttempts >= 5) {
        return { valid: false, reason: 'Maximum verification attempts exceeded. Please request a new OTP.' };
    }
    if (new Date() > this.whatsappOtpExpiry) {
        return { valid: false, reason: 'OTP has expired. Please request a new one.' };
    }

    const hashedInput = crypto.createHash('sha256').update(otpStr).digest('hex');
    if (hashedInput !== this.whatsappOtp) {
        this.whatsappOtpAttempts += 1;
        return { valid: false, reason: `Invalid OTP. ${5 - this.whatsappOtpAttempts} attempts remaining.` };
    }

    return { valid: true };
};

// Clear OTP fields after successful verification or expiry
userSchema.methods.clearOtp = function () {
    this.whatsappOtp = null;
    this.whatsappOtpExpiry = null;
    this.whatsappOtpAttempts = 0;
    this.whatsappPendingNumber = null;
};

module.exports = mongoose.model('User', userSchema);

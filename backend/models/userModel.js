const mongoose = require('mongoose');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    googleId: String,
    name: String,
    picture: String,

    // WhatsApp fields
    whatsappNumber: { type: String, default: null },
    whatsappVerified: { type: Boolean, default: false },
    whatsappNotificationsEnabled: { type: Boolean, default: true },

    // OTP fields
    whatsappOtp: { type: String, default: null },
    whatsappOtpExpiry: { type: Date, default: null },
    whatsappOtpAttempts: { type: Number, default: 0 },
    whatsappOtpLastSent: { type: Date, default: null },

    // Notification tracking
    lastWhatsappNotification: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});

userSchema.methods.setOtp = function (otp) {
    this.whatsappOtp = crypto.createHash('sha256').update(otp).digest('hex');
    this.whatsappOtpExpiry = new Date(Date.now() + 5 * 60 * 1000);
    this.whatsappOtpAttempts = 0;
};

userSchema.methods.verifyOtp = function (otp) {
    if (!this.whatsappOtp || !this.whatsappOtpExpiry) {
        return { valid: false, reason: 'No OTP requested' };
    }
    if (this.whatsappOtpAttempts >= 5) {
        return { valid: false, reason: 'Maximum verification attempts exceeded. Please request a new OTP.' };
    }
    if (new Date() > this.whatsappOtpExpiry) {
        return { valid: false, reason: 'OTP has expired. Please request a new one.' };
    }
    const hashedInput = crypto.createHash('sha256').update(otp).digest('hex');
    if (hashedInput !== this.whatsappOtp) {
        this.whatsappOtpAttempts += 1;
        return { valid: false, reason: `Invalid OTP. ${5 - this.whatsappOtpAttempts} attempts remaining.` };
    }
    return { valid: true };
};

userSchema.methods.clearOtp = function () {
    this.whatsappOtp = null;
    this.whatsappOtpExpiry = null;
    this.whatsappOtpAttempts = 0;
};

const trackingSchema = new mongoose.Schema({
    userEmail: { type: String, required: true, index: true },
    productName: String,
    currentPrice: Number,
    previousPrice: Number,
    targetPrice: { type: Number, required: true },
    url: { type: String, required: true },
    platform: String,
    image: String,
    currency: { type: String, default: '₹' },
    isActive: { type: Boolean, default: true },
    lastChecked: Date,
    notified: { type: Boolean, default: false },
    notifiedAt: Date,
    lastNotifiedPrice: Number,
    lastNotificationChannels: {
        email: { type: Boolean, default: false },
        whatsapp: { type: Boolean, default: false },
        timestamp: Date
    },
    repeatAlerts: { type: Boolean, default: false },
    failureCount: { type: Number, default: 0 },
    lastError: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});


trackingSchema.index({ userEmail: 1, url: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Tracking = mongoose.model('Tracking', trackingSchema);

module.exports = { User, Tracking };

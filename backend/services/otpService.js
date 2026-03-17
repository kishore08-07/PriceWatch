const crypto = require('crypto');
const User = require('../models/User');
const whatsappService = require('./whatsappService');

const OTP_LENGTH = 6;
const OTP_COOLDOWN_MS = 60 * 1000; // 1 minute between OTP requests

/**
 * Validate phone number format (E.164: +countrycode followed by number).
 * Accepts: +919876543210, +14155552671, etc.
 */
const validatePhoneNumber = (phone) => {
    const e164Regex = /^\+[1-9]\d{6,14}$/;
    return e164Regex.test(phone);
};

/**
 * Generate a cryptographically secure OTP.
 */
const generateOtp = () => {
    // Generate a random 6-digit number using crypto
    const buffer = crypto.randomBytes(4);
    const num = buffer.readUInt32BE(0) % 1000000;
    return num.toString().padStart(OTP_LENGTH, '0');
};

/**
 * Send a WhatsApp OTP to the user.
 * 
 * @param {string} email - User's email (identifier)
 * @param {string} phoneNumber - WhatsApp number in E.164 format (+919876543210)
 * @returns {Object} Result with success status and message
 */
const sendWhatsAppOtp = async (email, phoneNumber) => {
    // Validate phone format
    if (!validatePhoneNumber(phoneNumber)) {
        return {
            success: false,
            message: 'Invalid phone number format. Use E.164 format (e.g., +919876543210).'
        };
    }

    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
        return { success: false, message: 'User not found. Please sign in first.' };
    }

    // Rate limit: prevent OTP spam
    if (user.whatsappOtpLastSent) {
        const timeSinceLastOtp = Date.now() - user.whatsappOtpLastSent.getTime();
        if (timeSinceLastOtp < OTP_COOLDOWN_MS) {
            const waitSeconds = Math.ceil((OTP_COOLDOWN_MS - timeSinceLastOtp) / 1000);
            return {
                success: false,
                message: `Please wait ${waitSeconds} seconds before requesting a new OTP.`
            };
        }
    }

    // Check if WhatsApp service is connected
    const status = whatsappService.getStatus();
    if (!status.connected) {
        return {
            success: false,
            message: 'WhatsApp service is not connected. Please contact the administrator.'
        };
    }

    // Verify the number is registered on WhatsApp
    const registration = await whatsappService.isRegisteredOnWhatsApp(phoneNumber);
    if (!registration.registered) {
        return {
            success: false,
            message: 'This phone number is not registered on WhatsApp. Please use a valid WhatsApp number.'
        };
    }

    // Generate OTP and store it (hashed), staging the new number as pending
    const otp = generateOtp();
    user.setOtp(otp, phoneNumber); // stages phoneNumber as whatsappPendingNumber
    await user.save();

    // Send OTP via WhatsApp
    const message = `🔐 *PriceWatch Verification*\n\nYour OTP is: *${otp}*\n\nThis code expires in 5 minutes.\nDo not share this code with anyone.`;

    const result = await whatsappService.sendMessage(phoneNumber, message);

    if (result.success) {
        console.log(`[OTP] ✅ OTP sent to ${phoneNumber} for user ${email}`);
        return {
            success: true,
            message: 'OTP sent to your WhatsApp number. Please check your messages.'
        };
    } else {
        console.error(`[OTP] ❌ Failed to send OTP to ${phoneNumber}: ${result.reason}`);
        return {
            success: false,
            message: result.queued
                ? 'Message queued. WhatsApp connection issue — it will be sent when reconnected.'
                : `Failed to send OTP: ${result.reason}`
        };
    }
};

/**
 * Verify the OTP entered by the user.
 * 
 * @param {string} email - User's email
 * @param {string} otp - 6-digit OTP entered by user
 * @returns {Object} Result with success status
 */
const verifyWhatsAppOtp = async (email, otp) => {
    const otpStr = String(otp || '').trim();
    if (!otpStr || otpStr.length !== OTP_LENGTH || !/^\d{6}$/.test(otpStr)) {
        return { success: false, message: 'Please enter a valid 6-digit numeric OTP.' };
    }

    const user = await User.findOne({ email });
    if (!user) {
        return { success: false, message: 'User not found.' };
    }

    const verification = user.verifyOtp(otp);

    if (!verification.valid) {
        await user.save(); // Save incremented attempts
        console.log(`[OTP] ❌ Verification failed for ${email}: ${verification.reason}`);
        return { success: false, message: verification.reason };
    }

    // OTP is valid — promote pending number and mark user as verified
    const verifiedNumber = user.whatsappPendingNumber || user.whatsappNumber;
    user.whatsappNumber = verifiedNumber;
    user.whatsappVerified = true;
    user.clearOtp();
    await user.save();

    console.log(`[OTP] ✅ WhatsApp verified for user ${email} (${user.whatsappNumber})`);

    return {
        success: true,
        message: 'WhatsApp number verified successfully! You will now receive price alerts on WhatsApp.',
        whatsappNumber: user.whatsappNumber
    };
};

/**
 * Toggle WhatsApp notifications for a user.
 */
const toggleWhatsAppNotifications = async (email, enabled) => {
    const user = await User.findOne({ email });
    if (!user) {
        return { success: false, message: 'User not found.' };
    }

    if (!user.whatsappVerified) {
        return { success: false, message: 'WhatsApp number not verified. Please verify first.' };
    }

    user.whatsappNotificationsEnabled = enabled;
    await user.save();

    return {
        success: true,
        message: `WhatsApp notifications ${enabled ? 'enabled' : 'disabled'}.`,
        enabled
    };
};

/**
 * Get user's WhatsApp status.
 */
const getWhatsAppStatus = async (email) => {
    const user = await User.findOne({ email });
    if (!user) {
        return { success: false, message: 'User not found.' };
    }

    return {
        success: true,
        whatsappNumber: user.whatsappNumber,
        verified: user.whatsappVerified,
        notificationsEnabled: user.whatsappNotificationsEnabled
    };
};

module.exports = {
    sendWhatsAppOtp,
    verifyWhatsAppOtp,
    toggleWhatsAppNotifications,
    getWhatsAppStatus,
    validatePhoneNumber
};

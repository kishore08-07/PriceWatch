const { authenticateWithGoogle } = require('../services/authService');
const { sendWhatsAppOtp, verifyWhatsAppOtp, toggleWhatsAppNotifications, getWhatsAppStatus } = require('../services/otpService');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const googleAuth = async (req, res) => {
    const { token } = req.body;
    
    try {
        const result = await authenticateWithGoogle(token);
        return successResponse(res, { user: result.user });
    } catch (error) {
        return errorResponse(res, error.message, 401);
    }
};

// --- WhatsApp OTP Endpoints ---

const sendOtp = async (req, res) => {
    const { email, phoneNumber } = req.body;

    if (!email || !phoneNumber) {
        return errorResponse(res, 'Email and phone number are required.', 400);
    }

    try {
        const result = await sendWhatsAppOtp(email, phoneNumber);
        const statusCode = result.success ? 200 : 400;
        return res.status(statusCode).json(result);
    } catch (error) {
        console.error('[Auth] Send OTP error:', error);
        return errorResponse(res, 'Failed to send OTP. Please try again.', 500);
    }
};

const verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return errorResponse(res, 'Email and OTP are required.', 400);
    }

    try {
        const result = await verifyWhatsAppOtp(email, otp);
        const statusCode = result.success ? 200 : 400;
        return res.status(statusCode).json(result);
    } catch (error) {
        console.error('[Auth] Verify OTP error:', error);
        return errorResponse(res, 'Verification failed. Please try again.', 500);
    }
};

const toggleWhatsApp = async (req, res) => {
    const { email, enabled } = req.body;

    if (!email || typeof enabled !== 'boolean') {
        return errorResponse(res, 'Email and enabled (boolean) are required.', 400);
    }

    try {
        const result = await toggleWhatsAppNotifications(email, enabled);
        const statusCode = result.success ? 200 : 400;
        return res.status(statusCode).json(result);
    } catch (error) {
        console.error('[Auth] Toggle WhatsApp error:', error);
        return errorResponse(res, 'Failed to update notification preferences.', 500);
    }
};

const whatsAppStatus = async (req, res) => {
    const { email } = req.params;

    if (!email) {
        return errorResponse(res, 'Email is required.', 400);
    }

    try {
        const result = await getWhatsAppStatus(email);
        return res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
        console.error('[Auth] WhatsApp status error:', error);
        return errorResponse(res, 'Failed to get WhatsApp status.', 500);
    }
};

module.exports = { googleAuth, sendOtp, verifyOtp, toggleWhatsApp, whatsAppStatus };

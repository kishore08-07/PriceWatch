const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');
const { successResponse, errorResponse } = require('../utils/responseHelper');

/**
 * GET /api/whatsapp/status
 * Get WhatsApp connection status.
 */
router.get('/status', (req, res) => {
    const status = whatsappService.getStatus();
    return successResponse(res, { whatsapp: status }, 'WhatsApp status retrieved');
});

/**
 * POST /api/whatsapp/initialize
 * Initialize WhatsApp connection (generates QR code).
 * Should be called by admin to start the pairing process.
 */
router.post('/initialize', async (req, res) => {
    try {
        const status = whatsappService.getStatus();

        if (status.connected) {
            return successResponse(res, { whatsapp: status }, 'WhatsApp already connected');
        }

        if (status.connecting) {
            return successResponse(res, { whatsapp: status }, 'WhatsApp is already connecting. Check for QR code.');
        }

        await whatsappService.initialize();

        return successResponse(res, {
            whatsapp: whatsappService.getStatus(),
            message: 'WhatsApp initialization started. Scan the QR code displayed in the server terminal.'
        });
    } catch (error) {
        console.error('[WhatsApp Route] Init error:', error);
        return errorResponse(res, 'Failed to initialize WhatsApp: ' + error.message, 500);
    }
});

/**
 * GET /api/whatsapp/qr
 * Get the current QR code as a string (for rendering on frontend).
 */
router.get('/qr', (req, res) => {
    const qr = whatsappService.getQRCode();
    if (!qr) {
        return errorResponse(res, 'No QR code available. Either already connected or not initialized.', 404);
    }
    return successResponse(res, { qr }, 'QR code available. Scan with WhatsApp.');
});

/**
 * POST /api/whatsapp/disconnect
 * Disconnect WhatsApp session.
 */
router.post('/disconnect', async (req, res) => {
    try {
        await whatsappService.disconnect();
        return successResponse(res, {}, 'WhatsApp disconnected');
    } catch (error) {
        return errorResponse(res, 'Failed to disconnect: ' + error.message, 500);
    }
});

/**
 * POST /api/whatsapp/clear-session
 * Clear session data and force re-authentication.
 */
router.post('/clear-session', (req, res) => {
    whatsappService.clearSession();
    return successResponse(res, {}, 'WhatsApp session cleared. Re-initialize to pair again.');
});

/**
 * POST /api/whatsapp/test-message
 * Send a test message (admin/debug endpoint).
 */
router.post('/test-message', async (req, res) => {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
        return errorResponse(res, 'phoneNumber and message are required.', 400);
    }

    try {
        const result = await whatsappService.sendMessage(phoneNumber, message);
        if (result.success) {
            return successResponse(res, result, 'Test message sent');
        } else {
            return errorResponse(res, result.reason || 'Failed to send message', 400);
        }
    } catch (error) {
        return errorResponse(res, 'Error sending message: ' + error.message, 500);
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { googleAuth, sendOtp, verifyOtp, toggleWhatsApp, whatsAppStatus } = require('../controllers/authController');

router.post('/google', googleAuth);

// WhatsApp OTP verification
router.post('/whatsapp/send-otp', sendOtp);
router.post('/whatsapp/verify-otp', verifyOtp);
router.post('/whatsapp/toggle', toggleWhatsApp);
router.get('/whatsapp/status/:email', whatsAppStatus);

module.exports = router;

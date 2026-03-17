/**
 * WhatsApp Notification Feature — End-to-End Test Script
 *
 * Run with:  node backend/test-whatsapp.js
 *
 * Prerequisites:
 *  1. Backend server running on port 8000
 *  2. MongoDB connected
 *  3. At least one tracked product in DB (for notification tests)
 *  4. WhatsApp connected (or tests will show expected "not connected" errors)
 */

const BASE = 'http://localhost:8000/api';
let passed = 0;
let failed = 0;
let skipped = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const request = async (method, path, body = null) => {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const json = await res.json();
    return { status: res.status, ...json };
};

const assert = (condition, label, detail = '') => {
    if (condition) {
        console.log(`  ✅ PASS: ${label}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
};

const skip = (label, reason) => {
    console.log(`  ⏭️  SKIP: ${label} (${reason})`);
    skipped++;
};

const section = (title) => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🧪 ${title}`);
    console.log('─'.repeat(60));
};

// ─── Tests ────────────────────────────────────────────────────────────────────

const TEST_EMAIL = 'testuser@example.com';
const TEST_PHONE_VALID = '+919999999999';     // Replace with a real number to test
const TEST_PHONE_INVALID_FORMAT = '9876543210';  // Missing +91
const TEST_PHONE_SHORT = '+1';               // Too short
const TEST_OTP_WRONG = '000000';
const TEST_OTP_NON_NUMERIC = 'abcdef';
const TEST_OTP_TOO_SHORT = '123';

async function runTests() {
    console.log('\n🚀 PriceWatch WhatsApp — End-to-End Test Suite\n');

    // ── 1. WhatsApp Service Status ────────────────────────────────────────────
    section('1. WhatsApp Service Status');

    const statusRes = await request('GET', '/whatsapp/status');
    assert(statusRes.success === true, 'GET /whatsapp/status returns success');
    assert(typeof statusRes.whatsapp.connected === 'boolean', 'connected field is boolean');
    assert(typeof statusRes.whatsapp.connecting === 'boolean', 'connecting field is boolean');
    assert(typeof statusRes.whatsapp.queueSize === 'number', 'queueSize field is number');
    console.log(`     ℹ️  WhatsApp connected: ${statusRes.whatsapp.connected}`);
    const waConnected = statusRes.whatsapp.connected;

    // ── 2. Phone Number Validation ───────────────────────────────────────────
    section('2. Phone Number Format Validation');

    const invalidFormatRes = await request('POST', '/auth/whatsapp/send-otp', {
        email: TEST_EMAIL, phoneNumber: TEST_PHONE_INVALID_FORMAT
    });
    assert(invalidFormatRes.success === false, 'Rejects number without + country code');
    assert(invalidFormatRes.message.includes('E.164') || invalidFormatRes.message.includes('Invalid'), 
           'Returns helpful format message');

    const shortPhoneRes = await request('POST', '/auth/whatsapp/send-otp', {
        email: TEST_EMAIL, phoneNumber: TEST_PHONE_SHORT
    });
    assert(shortPhoneRes.success === false, 'Rejects too-short number (+1)');

    const emptyPhoneRes = await request('POST', '/auth/whatsapp/send-otp', {
        email: TEST_EMAIL, phoneNumber: ''
    });
    assert(emptyPhoneRes.success === false, 'Rejects empty phone number');
    assert(emptyPhoneRes.status === 400, 'Returns 400 for missing phone number');

    const missingEmailRes = await request('POST', '/auth/whatsapp/send-otp', {
        phoneNumber: TEST_PHONE_VALID
    });
    assert(missingEmailRes.success === false, 'Rejects missing email');
    assert(missingEmailRes.status === 400, 'Returns 400 for missing email');

    // ── 3. OTP Validation ─────────────────────────────────────────────────────
    section('3. OTP Input Validation');

    const wrongOtpRes = await request('POST', '/auth/whatsapp/verify-otp', {
        email: TEST_EMAIL, otp: TEST_OTP_WRONG
    });
    assert(wrongOtpRes.success === false, 'Rejects wrong OTP (no OTP was requested)');

    const nonNumericOtpRes = await request('POST', '/auth/whatsapp/verify-otp', {
        email: TEST_EMAIL, otp: TEST_OTP_NON_NUMERIC
    });
    assert(nonNumericOtpRes.success === false, 'Rejects non-numeric OTP');

    const shortOtpRes = await request('POST', '/auth/whatsapp/verify-otp', {
        email: TEST_EMAIL, otp: TEST_OTP_TOO_SHORT
    });
    assert(shortOtpRes.success === false, 'Rejects 3-digit OTP (too short)');
    assert(shortOtpRes.message.includes('6-digit'), 'Returns helpful message for short OTP');

    const numericOtpRes = await request('POST', '/auth/whatsapp/verify-otp', {
        email: TEST_EMAIL, otp: 123456   // Sent as number, not string
    });
    assert(numericOtpRes.success === false, 'Handles numeric OTP without crashing');
    // Should return "No OTP requested" or "Invalid OTP", not a server 500
    assert(numericOtpRes.status !== 500, 'Does not crash on numeric OTP input (bug fix verified)');

    const missingOtpRes = await request('POST', '/auth/whatsapp/verify-otp', {
        email: TEST_EMAIL
    });
    assert(missingOtpRes.success === false, 'Rejects missing OTP field');
    assert(missingOtpRes.status === 400, 'Returns 400 for missing OTP');

    // ── 4. User Not Found Handling ────────────────────────────────────────────
    section('4. User Not Found Handling');

    const unknownUserRes = await request('POST', '/auth/whatsapp/send-otp', {
        email: 'nonexistent@nowhere.com', phoneNumber: TEST_PHONE_VALID
    });
    assert(unknownUserRes.success === false, 'Rejects send-otp for unknown user');
    assert(unknownUserRes.message.includes('not found') || unknownUserRes.message.includes('sign in'),
           'Returns helpful user-not-found message');

    const statusUnknownRes = await request('GET', '/auth/whatsapp/status/nonexistent@nowhere.com');
    assert(statusUnknownRes.success === false, 'GET status for unknown user returns failure');
    assert(statusUnknownRes.status === 404, 'Returns 404 for unknown user status');

    // ── 5. Toggle Validation ──────────────────────────────────────────────────
    section('5. Toggle WhatsApp Notifications Validation');

    const toggleMissingEnabledRes = await request('POST', '/auth/whatsapp/toggle', {
        email: TEST_EMAIL
        // enabled missing
    });
    assert(toggleMissingEnabledRes.success === false, 'Rejects toggle without enabled field');
    assert(toggleMissingEnabledRes.status === 400, 'Returns 400 for missing enabled');

    const toggleStringEnabledRes = await request('POST', '/auth/whatsapp/toggle', {
        email: TEST_EMAIL, enabled: 'true'  // String instead of boolean
    });
    assert(toggleStringEnabledRes.success === false, 'Rejects string "true" for enabled (must be boolean)');
    assert(toggleStringEnabledRes.status === 400, 'Returns 400 for non-boolean enabled');

    // ── 6. WhatsApp Connection Required ──────────────────────────────────────
    section('6. WhatsApp Connection Guard');

    if (!waConnected) {
        // When WA is not connected, sending OTP should fail gracefully (not crash)
        // We can only test this for a user that exists; skip if user doesn't exist in DB
        console.log('     ℹ️  WhatsApp not connected — verifying graceful failure...');
        const disconnectedOtpRes = await request('POST', '/auth/whatsapp/send-otp', {
            email: TEST_EMAIL, phoneNumber: TEST_PHONE_VALID
        });
        // Should fail with a user-friendly message, not a 500
        const isGraceful = disconnectedOtpRes.success === false &&
                           disconnectedOtpRes.status !== 500 &&
                           (disconnectedOtpRes.message?.toLowerCase().includes('not connected') ||
                            disconnectedOtpRes.message?.toLowerCase().includes('not found'));
        assert(isGraceful, 'Fails gracefully when WhatsApp not connected (no server crash)');
    } else {
        skip('WhatsApp disconnected guard', 'WhatsApp is currently connected');
    }

    // ── 7. Admin Routes ───────────────────────────────────────────────────────
    section('7. Admin Route Structure');

    const initRes = await request('POST', '/whatsapp/initialize');
    assert(typeof initRes.success === 'boolean', 'POST /whatsapp/initialize responds');
    assert(initRes.status !== 500, 'Initialize does not crash');

    const qrRes = await request('GET', '/whatsapp/qr');
    // Either returns QR or 404 (already connected)
    assert(qrRes.status === 200 || qrRes.status === 404, 'GET /whatsapp/qr returns 200 or 404');

    // ── 8. Test WhatsApp Endpoint on Invalid Tracking ID ─────────────────────
    section('8. Test WhatsApp Endpoint Edge Cases');

    const testWaInvalidId = await request('POST', '/tracker/test-whatsapp/000000000000000000000000');
    assert(testWaInvalidId.success === false, 'Returns failure for non-existent tracking ID');
    assert(testWaInvalidId.status === 404, 'Returns 404 for non-existent tracking ID');

    const testEmailInvalidId = await request('POST', '/tracker/test-email/000000000000000000000000');
    assert(testEmailInvalidId.success === false, 'test-email also returns failure for non-existent ID');
    assert(testEmailInvalidId.status === 404, 'test-email returns 404 for non-existent ID');

    // ── 9. Message Formatting ─────────────────────────────────────────────────
    section('9. Message Formatting (Unit)');

    const { formatPriceAlertMessage } = require('./services/whatsappNotificationService');

    const msg1 = formatPriceAlertMessage({
        productName: 'Sony WH-1000XM5',
        platform: 'Amazon',
        currentPrice: 23999,
        targetPrice: 25000,
        previousPrice: 28999,
        url: 'https://amazon.in/test',
        currency: '₹'
    });

    assert(msg1.includes('Sony WH-1000XM5'), 'Message includes product name');
    assert(msg1.includes('Amazon'), 'Message includes platform');
    assert(msg1.includes('23,999'), 'Message includes formatted current price');
    assert(msg1.includes('25,000'), 'Message includes formatted target price');
    assert(msg1.includes('28,999'), 'Message includes previous price when available');
    assert(msg1.includes('5,000') || msg1.includes('₹5,000'), 'Message includes savings');
    assert(msg1.includes('https://amazon.in/test'), 'Message includes product URL');
    assert(msg1.includes('PriceWatch'), 'Message includes branding');

    const msg2 = formatPriceAlertMessage({
        productName: 'Test Product',
        platform: null,  // Missing platform
        currentPrice: 1000,
        targetPrice: 1200,
        previousPrice: null, // No previous price
        url: 'https://test.com',
        currency: null  // Missing currency
    });
    assert(msg2.includes('₹'), 'Falls back to ₹ when currency is null');
    assert(msg2.includes('Unknown'), 'Falls back to Unknown when platform is null');
    assert(!msg2.includes('undefined'), 'No "undefined" strings in message');
    assert(!msg2.includes('NaN'), 'No "NaN" strings in message');
    assert(!msg2.includes('null'), 'No "null" strings in message');

    // ── 10. OTP Hash Security ────────────────────────────────────────────────
    section('10. OTP Hash Security (Unit)');

    const crypto = require('crypto');
    const mongoose = require('mongoose');
    const User = require('./models/User');

    // Create a temporary in-memory user object (no DB needed)
    const mockUser = new User({ email: 'mock@test.com' });
    mockUser.setOtp('123456', '+919999999999');

    assert(mockUser.whatsappOtp !== '123456', 'OTP is NOT stored in plain text');
    assert(mockUser.whatsappOtp.length === 64, 'OTP is stored as SHA-256 hex (64 chars)');
    assert(!!mockUser.whatsappOtpExpiry, 'OTP expiry is set');
    assert(mockUser.whatsappOtpAttempts === 0, 'Attempts reset to 0 on new OTP');
    assert(!!mockUser.whatsappOtpLastSent, 'lastSent set atomically in setOtp');
    assert(mockUser.whatsappPendingNumber === '+919999999999', 'Pending number staged correctly');

    const goodVerify = mockUser.verifyOtp('123456');
    assert(goodVerify.valid === true, 'Correct OTP verifies successfully');

    const badVerify = mockUser.verifyOtp('999999');
    assert(badVerify.valid === false, 'Wrong OTP fails verification');
    assert(mockUser.whatsappOtpAttempts === 1, 'Attempt counter incremented on wrong OTP');

    const numericVerify = mockUser.verifyOtp(123456);  // Number, not string
    assert(typeof numericVerify.valid === 'boolean', 'Numeric OTP input handled without crash');

    // Test expiry
    const expiredUser = new User({ email: 'expired@test.com' });
    expiredUser.setOtp('654321');
    expiredUser.whatsappOtpExpiry = new Date(Date.now() - 1000); // 1 second ago
    const expiredVerify = expiredUser.verifyOtp('654321');
    assert(expiredVerify.valid === false, 'Expired OTP is rejected');
    assert(expiredVerify.reason.includes('expired'), 'Returns expiry message');

    // Test max attempts lockout
    const lockedUser = new User({ email: 'locked@test.com' });
    lockedUser.setOtp('111111');
    lockedUser.whatsappOtpAttempts = 5;
    const lockedVerify = lockedUser.verifyOtp('111111');
    assert(lockedVerify.valid === false, 'Locked-out user cannot verify even with correct OTP');
    assert(lockedVerify.reason.toLowerCase().includes('maximum') || lockedVerify.reason.toLowerCase().includes('exceeded'),
           'Returns lockout message');

    const clearUser = new User({ email: 'clear@test.com' });
    clearUser.setOtp('555555', '+910000000001');
    clearUser.clearOtp();
    assert(clearUser.whatsappOtp === null, 'clearOtp nullifies the OTP');
    assert(clearUser.whatsappOtpExpiry === null, 'clearOtp nullifies expiry');
    assert(clearUser.whatsappPendingNumber === null, 'clearOtp nullifies pending number');

    // ── Results ───────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}  ⏭️  Skipped: ${skipped}`);
    console.log('═'.repeat(60));

    if (failed > 0) {
        console.log('\n⚠️  Some tests failed. Check the output above for details.');
        process.exit(1);
    } else {
        console.log('\n🎉 All tests passed!');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('\n💥 Test runner crashed:', err.message);
    console.error(err.stack);
    process.exit(1);
});

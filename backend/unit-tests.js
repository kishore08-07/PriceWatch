const User = require('./models/User');
const { formatPriceAlertMessage } = require('./services/whatsappNotificationService');
const { validatePhoneNumber } = require('./services/otpService');
const whatsappService = require('./services/whatsappService');

let p = 0, f = 0;
const ok = (cond, lbl) => {
    if (cond) { console.log('  PASS: ' + lbl); p++; }
    else { console.error('  FAIL: ' + lbl); f++; }
};

console.log('\n--- 1. Phone Validation ---');
ok(validatePhoneNumber('+919876543210'), 'Valid IN number');
ok(validatePhoneNumber('+14155552671'), 'Valid US number');
ok(!validatePhoneNumber('9876543210'), 'Rejects no + prefix');
ok(!validatePhoneNumber('+1'), 'Rejects too short (+1 only)');
ok(!validatePhoneNumber(''), 'Rejects empty string');
ok(!validatePhoneNumber('+919876'), 'Rejects 5-digit body (too short)');
ok(!validatePhoneNumber('+91987654321012345'), 'Rejects 15-digit body (too long)');

console.log('\n--- 2. OTP Hash Security ---');
const u = new User({ email: 't@t.com' });
u.setOtp('123456', '+919999999999');
ok(u.whatsappOtp !== '123456', 'OTP not stored in plaintext');
ok(u.whatsappOtp.length === 64, 'OTP stored as SHA-256 hex (64 chars)');
ok(!!u.whatsappOtpExpiry, 'Expiry is set');
ok(u.whatsappOtpAttempts === 0, 'Attempts reset to 0');
ok(!!u.whatsappOtpLastSent, 'lastSent set atomically inside setOtp');
ok(u.whatsappPendingNumber === '+919999999999', 'Pending number staged correctly');

console.log('\n--- 3. OTP Verification ---');
const uv = new User({ email: 'v@t.com' });
uv.setOtp('654321');
ok(uv.verifyOtp('654321').valid === true, 'Correct OTP passes');
ok(uv.verifyOtp('000000').valid === false, 'Wrong OTP fails');
ok(uv.whatsappOtpAttempts === 1, 'Attempt counter incremented after wrong OTP');
ok(typeof uv.verifyOtp(654321).valid === 'boolean', 'Numeric OTP input handled without crash');

console.log('\n--- 4. OTP Expiry ---');
const ue = new User({ email: 'e@t.com' });
ue.setOtp('111111');
ue.whatsappOtpExpiry = new Date(Date.now() - 1000);
const ev = ue.verifyOtp('111111');
ok(ev.valid === false, 'Expired OTP rejected');
ok(ev.reason.includes('expired'), 'Expiry reason message returned');

console.log('\n--- 5. Brute Force Lockout ---');
const ul = new User({ email: 'l@t.com' });
ul.setOtp('222222');
ul.whatsappOtpAttempts = 5;
const lv = ul.verifyOtp('222222');
ok(lv.valid === false, 'Locked out even with correct OTP after 5 attempts');
ok(lv.reason.toLowerCase().includes('maximum') || lv.reason.toLowerCase().includes('exceeded'), 'Lockout message returned');

console.log('\n--- 6. clearOtp ---');
const uc = new User({ email: 'c@t.com' });
uc.setOtp('333333', '+910000001');
uc.clearOtp();
ok(uc.whatsappOtp === null, 'OTP cleared');
ok(uc.whatsappOtpExpiry === null, 'Expiry cleared');
ok(uc.whatsappPendingNumber === null, 'Pending number cleared after clearOtp');

console.log('\n--- 7. Phone Number Change Safety ---');
const un = new User({ email: 'n@t.com', whatsappNumber: '+919111111111', whatsappVerified: true });
un.setOtp('444444', '+919222222222');
ok(un.whatsappNumber === '+919111111111', 'Old verified number preserved during pending OTP');
ok(un.whatsappPendingNumber === '+919222222222', 'New number staged as pending only');

console.log('\n--- 8. Message Formatting ---');
const m1 = formatPriceAlertMessage({
    productName: 'Sony WH-1000XM5', platform: 'Amazon',
    currentPrice: 23999, targetPrice: 25000, previousPrice: 28999,
    url: 'https://amazon.in/test', currency: 'Rs'
});
ok(m1.includes('Sony WH-1000XM5'), 'Product name in message');
ok(m1.includes('Amazon'), 'Platform in message');
ok(m1.includes('23,999'), 'Current price formatted with commas');
ok(m1.includes('25,000'), 'Target price formatted with commas');
ok(m1.includes('28,999'), 'Previous price shown');
ok(m1.includes('amazon.in'), 'URL present');
ok(m1.includes('PriceWatch'), 'PriceWatch branding');

const m2 = formatPriceAlertMessage({
    productName: 'Test', platform: null,
    currentPrice: 1000, targetPrice: 1200,
    previousPrice: null, url: 'https://t.com', currency: null
});
ok(m2.includes('\u20b9'), 'Falls back to rupee when currency null');
ok(m2.includes('Unknown'), 'Falls back to Unknown when platform null');
ok(!m2.includes('undefined'), 'No "undefined" strings in message');
ok(!m2.includes('NaN'), 'No "NaN" strings in message');
ok(!m2.includes('null'), 'No "null" strings in message');

const m3 = formatPriceAlertMessage({
    productName: 'Item', platform: 'Flipkart',
    currentPrice: 500, targetPrice: 600,
    previousPrice: 500, url: 'https://f.com', currency: 'Rs' // same previous price
});
ok(!m3.includes('Previous Price'), 'No previous price shown when unchanged');

console.log('\n--- 9. WhatsApp Service Default State ---');
const status = whatsappService.getStatus();
ok(status.connected === false, 'Not connected on startup');
ok(status.connecting === false, 'Not in connecting state');
ok(status.queueSize === 0, 'Empty queue on startup');
ok(status.reconnectAttempts === 0, 'Zero reconnect attempts on startup');
ok(whatsappService.getQRCode() === null, 'No QR code before initialization');

console.log('\n=====================================');
console.log('PASS: ' + p + '  FAIL: ' + f);
if (f > 0) { console.error('\nSome tests FAILED.'); process.exit(1); }
else { console.log('\nAll unit tests passed!'); }

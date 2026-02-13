const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

console.log('🔍 Testing SMTP Configuration...\n');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? `${process.env.EMAIL_PASS.substring(0, 4)}****` : 'NOT SET');
console.log('');

// Test with port 587 (TLS)
console.log('Testing port 587 (TLS)...');
const transporter587 = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    debug: true // Enable debug output
});

transporter587.verify((error, success) => {
    if (error) {
        console.error('❌ Port 587 failed:', error.message);
        
        // Test with port 465 (SSL)
        console.log('\nTesting port 465 (SSL)...');
        const transporter465 = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        transporter465.verify((error2, success2) => {
            if (error2) {
                console.error('❌ Port 465 failed:', error2.message);
                console.error('\n⚠️  TROUBLESHOOTING STEPS:');
                console.error('1. Verify your app password is correct (16 characters, no spaces)');
                console.error('2. Generate a new app password at: https://myaccount.google.com/apppasswords');
                console.error('3. Check if your firewall/network blocks SMTP ports');
                console.error('4. Try from a different network (mobile hotspot)');
            } else {
                console.log('✅ Port 465 works! Updating config...');
            }
        });
    } else {
        console.log('✅ Port 587 works! Connection successful.');
        
        // Send a test email
        console.log('\nSending test email...');
        transporter587.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'PriceWatch Test Email',
            text: 'If you receive this, your email configuration is working correctly!'
        }, (err, info) => {
            if (err) {
                console.error('❌ Failed to send email:', err.message);
            } else {
                console.log('✅ Test email sent successfully!');
                console.log('   Message ID:', info.messageId);
            }
            process.exit(0);
        });
    }
});

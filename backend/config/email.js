const nodemailer = require('nodemailer');

// Validate email configuration
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('❌ EMAIL CONFIGURATION ERROR:');
    console.error('   Missing EMAIL_USER or EMAIL_PASS in .env file');
    console.error('   Email notifications will NOT work!');
    console.error('   Please add to .env:');
    console.error('   EMAIL_USER=your-email@gmail.com');
    console.error('   EMAIL_PASS=your-app-password');
    console.error('');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
    }
});

// Verify connection on startup (optional - helps catch errors early)
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter.verify((error, success) => {
        if (error) {
            console.error('❌ Email transporter verification failed:', error.message);
            console.error('   Check your EMAIL_USER and EMAIL_PASS in .env');
        } else {
            console.log('✅ Email transporter ready');
        }
    });
}

module.exports = transporter;

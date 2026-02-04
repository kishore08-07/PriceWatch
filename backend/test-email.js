/**
 * Test script for email notifications
 * Usage: node test-email.js <tracking_id>
 * 
 * This script will:
 * 1. Connect to MongoDB
 * 2. Find the tracking by ID
 * 3. Simulate a price drop below target
 * 4. Send a test email notification
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Tracking = require('./models/Tracking');

dotenv.config();

// Email configuration
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendTestEmail = async (tracking) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: tracking.userEmail,
        subject: `🎯 Price Drop Alert: ${tracking.productName}!`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #10b981;">🎉 Good news! Your product is now cheaper.</h2>
                <p><strong>${tracking.productName}</strong> has dropped to <strong style="color: #10b981;">₹${tracking.currentPrice}</strong>.</p>
                <p style="color: #6b7280;">Target Price was: ₹${tracking.targetPrice}</p>
                <div style="margin: 20px 0;">
                    <a href="${tracking.url}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600;">
                        Buy Now
                    </a>
                </div>
                ${tracking.image ? `<img src="${tracking.image}" width="200" style="border-radius: 8px;" />` : ''}
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="font-size: 12px; color: #9ca3af;">
                    This is an automated alert from PriceWatch. You're receiving this because you set up a price alert for this product.
                </p>
            </div>
        `
    };

    return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("❌ Email Error:", error);
                reject(error);
            } else {
                console.log("✅ Email sent successfully:", info.response);
                resolve(info);
            }
        });
    });
};

const runTest = async () => {
    const trackingId = process.argv[2];

    if (!trackingId) {
        console.error("❌ Error: Please provide a tracking ID");
        console.log("Usage: node test-email.js <tracking_id>");
        console.log("\nTo get tracking IDs, run:");
        console.log("  node test-email.js list <email>");
        process.exit(1);
    }

    try {
        console.log("🔌 Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("✅ Connected to MongoDB");

        if (trackingId === 'list') {
            const email = process.argv[3];
            if (!email) {
                console.error("❌ Error: Please provide an email address");
                console.log("Usage: node test-email.js list <email>");
                process.exit(1);
            }

            const trackings = await Tracking.find({ userEmail: email, isActive: true });
            console.log(`\n📋 Active alerts for ${email}:\n`);
            
            if (trackings.length === 0) {
                console.log("No active alerts found");
            } else {
                trackings.forEach((t, i) => {
                    console.log(`${i + 1}. ${t.productName}`);
                    console.log(`   ID: ${t._id}`);
                    console.log(`   Current: ₹${t.currentPrice || 'N/A'}, Target: ₹${t.targetPrice}`);
                    console.log(`   Notified: ${t.notified ? 'Yes' : 'No'}`);
                    console.log();
                });
            }

            await mongoose.connection.close();
            process.exit(0);
        }

        console.log(`\n🔍 Finding tracking with ID: ${trackingId}`);
        const tracking = await Tracking.findById(trackingId);

        if (!tracking) {
            console.error("❌ Error: Tracking not found");
            console.log("\nTip: Use 'node test-email.js list <email>' to see available tracking IDs");
            await mongoose.connection.close();
            process.exit(1);
        }

        console.log(`\n📦 Found tracking:`);
        console.log(`   Product: ${tracking.productName}`);
        console.log(`   User: ${tracking.userEmail}`);
        console.log(`   Current Price: ₹${tracking.currentPrice || 'N/A'}`);
        console.log(`   Target Price: ₹${tracking.targetPrice}`);
        console.log(`   Platform: ${tracking.platform}`);
        console.log(`   Notified: ${tracking.notified ? 'Yes' : 'No'}`);

        // Simulate price drop
        const simulatedPrice = Math.floor(tracking.targetPrice * 0.9); // 10% below target
        console.log(`\n💰 Simulating price drop to: ₹${simulatedPrice}`);

        tracking.currentPrice = simulatedPrice;
        tracking.lastChecked = new Date();
        await tracking.save();

        console.log(`\n📧 Sending test email to ${tracking.userEmail}...`);
        await sendTestEmail(tracking);

        // Mark as notified
        tracking.notified = true;
        tracking.notifiedAt = new Date();
        await tracking.save();

        console.log(`\n✅ Test completed successfully!`);
        console.log(`\n📝 Summary:`);
        console.log(`   ✓ Price updated to ₹${simulatedPrice}`);
        console.log(`   ✓ Email sent to ${tracking.userEmail}`);
        console.log(`   ✓ Notification status updated`);

        await mongoose.connection.close();
        console.log("\n🔌 Database connection closed");

    } catch (error) {
        console.error("\n❌ Test failed:", error.message);
        await mongoose.connection.close();
        process.exit(1);
    }
};

// Run the test
runTest();

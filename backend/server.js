const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const axios = require('axios');
const { User, Tracking } = require('./models/userModel');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Connect to MongoDB
if (!process.env.MONGODB_URI) {
    console.error("ERROR: MONGODB_URI not found in .env file");
    process.exit(1);
}
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => {
        console.error("Could not connect to MongoDB", err);
        process.exit(1);
    });

// --- Auth API ---
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    try {
        // Use the access token to get user info from Google
        const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const payload = response.data;

        let user = await User.findOne({ email: payload.email });
        if (!user) {
            user = new User({
                email: payload.email,
                googleId: payload.sub,
                name: payload.name,
                picture: payload.picture
            });
            await user.save();
        }

        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("SSO Error:", error.response?.data || error.message);
        res.status(401).json({ success: false, message: "Invalid Token" });
    }
});

// --- Tracking API ---
app.post('/api/tracker/add', async (req, res) => {
    const { userEmail, productName, currentPrice, targetPrice, url, platform, image, currency } = req.body;
    console.log("[Backend] Received tracking request:", { userEmail, productName, url, targetPrice });

    try {
        // Validation: Check required fields
        if (!userEmail || !url || !targetPrice) {
            console.error("[Backend] Missing required fields");
            return res.status(400).json({
                success: false,
                message: "Missing required fields: userEmail, url, and targetPrice are mandatory"
            });
        }

        // Validation: Check target price is a positive number
        const parsedTargetPrice = parseFloat(targetPrice);
        if (isNaN(parsedTargetPrice) || parsedTargetPrice <= 0) {
            console.error("[Backend] Invalid target price:", targetPrice);
            return res.status(400).json({
                success: false,
                message: "Target price must be a positive number"
            });
        }

        // Validation: Check target price is less than or equal to current price
        const parsedCurrentPrice = parseFloat(currentPrice);
        if (!isNaN(parsedCurrentPrice) && parsedTargetPrice > parsedCurrentPrice) {
            console.error("[Backend] Target price exceeds current price");
            return res.status(400).json({
                success: false,
                message: "Target price must be less than or equal to current price"
            });
        }

        // Check if alert already exists for this user + product URL
        const existingTracking = await Tracking.findOne({
            userEmail,
            url
        });

        if (existingTracking) {
            // Update existing alert instead of creating duplicate
            existingTracking.productName = productName || existingTracking.productName;
            existingTracking.currentPrice = parsedCurrentPrice || existingTracking.currentPrice;
            existingTracking.targetPrice = parsedTargetPrice;
            existingTracking.platform = platform || existingTracking.platform;
            existingTracking.image = image || existingTracking.image;
            existingTracking.currency = currency || existingTracking.currency;
            existingTracking.isActive = true;
            existingTracking.updatedAt = new Date();

            // Reset notification status if target price changed
            if (existingTracking.notified && !existingTracking.repeatAlerts) {
                existingTracking.notified = false;
                existingTracking.notifiedAt = null;
            }

            await existingTracking.save();
            console.log(`[Backend] Updated existing alert for ${productName} for ${userEmail}`);

            return res.status(200).json({
                success: true,
                tracking: existingTracking,
                message: "Price alert updated successfully"
            });
        }

        // Create new tracking entry
        const newTracking = new Tracking({
            userEmail,
            productName,
            currentPrice: parsedCurrentPrice,
            targetPrice: parsedTargetPrice,
            url,
            platform,
            image,
            currency: currency || '₹',
            isActive: true,
            notified: false,
            failureCount: 0
        });

        await newTracking.save();
        console.log(`[Backend] New product tracked: ${productName} for ${userEmail}`);
        res.status(201).json({
            success: true,
            tracking: newTracking,
            message: "Price alert created successfully"
        });

    } catch (error) {
        console.error("Tracking Error:", error);

        // Handle MongoDB duplicate key error (in case index hasn't been applied yet)
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "A price alert already exists for this product. Please refresh and try again."
            });
        }

        res.status(500).json({
            success: false,
            message: "Error saving price alert. Please try again.",
            error: error.message
        });
    }
});

// Check if alert exists for a product
app.get('/api/tracker/check/:email/:url', async (req, res) => {
    try {
        const { email, url } = req.params;
        const decodedUrl = decodeURIComponent(url);

        const tracking = await Tracking.findOne({
            userEmail: email,
            url: decodedUrl
        });

        res.json({
            exists: !!tracking,
            tracking: tracking || null
        });
    } catch (error) {
        console.error("Check tracking error:", error);
        res.status(500).json({ message: "Error checking alert status" });
    }
});

// Get user watchlist
app.get('/api/tracker/list/:email', async (req, res) => {
    try {
        const list = await Tracking.find({ userEmail: req.params.email, isActive: true });
        res.json(list);
    } catch (error) {
        res.status(500).json({ message: "Error fetching watchlist" });
    }
});

// Deactivate/Delete an alert
app.delete('/api/tracker/delete/:id', async (req, res) => {
    try {
        const tracking = await Tracking.findById(req.params.id);

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Alert not found"
            });
        }

        // Soft delete - mark as inactive
        tracking.isActive = false;
        tracking.updatedAt = new Date();
        await tracking.save();

        res.json({
            success: true,
            message: "Alert deactivated successfully"
        });
    } catch (error) {
        console.error("Delete alert error:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting alert"
        });
    }
});

// Remove alert by email and URL (called from frontend)
app.delete('/api/tracker/remove/:email/:url', async (req, res) => {
    try {
        const { email, url } = req.params;
        const decodedUrl = decodeURIComponent(url);

        const result = await Tracking.deleteOne({
            userEmail: email,
            url: decodedUrl
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Alert not found"
            });
        }

        res.json({
            success: true,
            message: "Alert permanently deleted"
        });
    } catch (error) {
        console.error("Remove alert error:", error);
        res.status(500).json({
            success: false,
            message: "Error removing alert"
        });
    }
});

// Manually trigger a price check for testing
app.post('/api/tracker/check-now/:id', async (req, res) => {
    try {
        const tracking = await Tracking.findById(req.params.id);

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Alert not found"
            });
        }

        if (!tracking.isActive) {
            return res.status(400).json({
                success: false,
                message: "Alert is not active"
            });
        }

        // Trigger immediate price check
        await checkPriceForTracking(tracking);

        // Fetch updated tracking data
        const updatedTracking = await Tracking.findById(req.params.id);

        res.json({
            success: true,
            message: "Price check completed",
            tracking: updatedTracking,
            priceReached: updatedTracking.currentPrice <= updatedTracking.targetPrice,
            emailSent: updatedTracking.notified
        });
    } catch (error) {
        console.error("Manual check error:", error);
        res.status(500).json({
            success: false,
            message: "Error triggering price check",
            error: error.message
        });
    }
});

// Test endpoint to simulate price drop and send email
app.post('/api/tracker/test-email/:id', async (req, res) => {
    try {
        const tracking = await Tracking.findById(req.params.id);

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Alert not found"
            });
        }

        // Simulate price drop to below target
        const simulatedPrice = tracking.targetPrice * 0.9; // 10% below target
        tracking.currentPrice = simulatedPrice;
        tracking.lastChecked = new Date();
        await tracking.save();

        // Send notification
        await sendPushNotification(tracking);

        res.json({
            success: true,
            message: "Test email sent successfully",
            simulatedPrice,
            targetPrice: tracking.targetPrice,
            emailSent: tracking.notified,
            notifiedAt: tracking.notifiedAt
        });
    } catch (error) {
        console.error("Test email error:", error);
        res.status(500).json({
            success: false,
            message: "Error sending test email",
            error: error.message
        });
    }
});

// --- Email Service ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendEmailAlert = (email, product) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: `Price Drop Alert: ${product.productName}!`,
        html: `
      <h2>Good news! Your product is now cheaper.</h2>
      <p><b>${product.productName}</b> has dropped to <b>₹${product.currentPrice}</b>.</p>
      <p>Target Price was: ₹${product.targetPrice}</p>
      <a href="${product.url}" style="padding: 10px 20px; background: #6366f1; color: white; border-radius: 5px; text-decoration: none;">Buy Now</a>
      <br/><br/>
      <img src="${product.image}" width="200" />
    `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) console.error("Email Error:", error);
        else console.log("Email sent:", info.response);
    });
};

// --- Price Monitoring API ---
// DEPRECATED: This endpoint is replaced by the cron job that properly tracks notifications
// Keeping it commented out to avoid duplicate email alerts
/*
app.post('/api/price/check', async (req, res) => {
    const { url, productName, targetPrice, userEmail } = req.body;

    try {
        const simulatedPrice = Math.floor(targetPrice * 0.95);

        const result = {
            productName,
            currentPrice: simulatedPrice,
            platform: url.includes('amazon') ? 'Amazon' : 'Flipkart',
            url
        };

        if (simulatedPrice <= targetPrice) {
            console.log(`Target reached for ${productName}. Sending alert to ${userEmail}`);
            sendEmailAlert(userEmail, { ...result, targetPrice });
        }

        res.json(result);
    } catch (error) {
        console.error("Price Check Error:", error);
        res.status(500).json({ message: "Failed to check price" });
    }
});
*/

// --- Background Price Monitor (Cron Job) ---
// Helper function to scrape product price from URL
const scrapeProductPrice = async (url) => {
    try {
        // This is a simplified version - in production, you'd use a headless browser
        // or a proper web scraping service
        const axios = require('axios');
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        // Basic price extraction (this would need to be more sophisticated)
        const html = response.data;
        let price = null;

        // Try to extract price from common patterns
        const pricePatterns = [
            /₹[\s]*([0-9,]+)/,
            /"price"[\s]*:[\s]*"?([0-9,]+)"?/,
            /priceToPay[\s]*:[\s]*([0-9,]+)/
        ];

        for (const pattern of pricePatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                const priceValue = parseFloat(match[1].replace(/,/g, ''));
                if (!isNaN(priceValue) && priceValue > 0) {
                    price = priceValue;
                    break;
                }
            }
        }

        return price;
    } catch (error) {
        console.error(`Scraping error for ${url}:`, error.message);
        throw new Error(`Failed to scrape: ${error.message}`);
    }
};

// Send browser push notification (via email for now, but could be extended to use Chrome notifications API)
const sendPushNotification = async (tracking) => {
    console.log(`[Notification] Sending alert for ${tracking.productName}`);

    // Send email notification
    sendEmailAlert(tracking.userEmail, {
        productName: tracking.productName,
        currentPrice: tracking.currentPrice,
        targetPrice: tracking.targetPrice,
        url: tracking.url,
        image: tracking.image,
        platform: tracking.platform
    });

    // Mark as notified
    tracking.notified = true;
    tracking.notifiedAt = new Date();
    await tracking.save();

    return true;
};

// Main price checking function with comprehensive error handling
const checkPriceForTracking = async (tracking) => {
    const MAX_FAILURES = 5;

    try {
        console.log(`[Cron] Checking price for ${tracking.productName} (${tracking.platform})`);

        // Skip if already notified and repeat alerts are disabled
        if (tracking.notified && !tracking.repeatAlerts) {
            console.log(`[Cron] Skipping ${tracking.productName} - already notified`);
            return;
        }

        // Skip if too many failures
        if (tracking.failureCount >= MAX_FAILURES) {
            console.log(`[Cron] Skipping ${tracking.productName} - too many failures (${tracking.failureCount})`);
            // Optionally deactivate the alert
            if (tracking.failureCount >= MAX_FAILURES * 2) {
                tracking.isActive = false;
                tracking.lastError = 'Deactivated due to repeated failures';
                await tracking.save();
            }
            return;
        }

        // Try to scrape the current price
        let currentPrice = null;
        try {
            currentPrice = await scrapeProductPrice(tracking.url);
        } catch (scrapeError) {
            // Handle scraping failure
            tracking.failureCount += 1;
            tracking.lastError = scrapeError.message;
            tracking.updatedAt = new Date();
            await tracking.save();

            console.error(`[Cron] Scraping failed for ${tracking.productName}: ${scrapeError.message}`);
            return;
        }

        if (currentPrice === null) {
            tracking.failureCount += 1;
            tracking.lastError = 'Price not found - product may be unavailable';
            tracking.updatedAt = new Date();
            await tracking.save();
            console.log(`[Cron] Could not extract price for ${tracking.productName}`);
            return;
        }

        // Successfully scraped - reset failure count
        tracking.failureCount = 0;
        tracking.lastError = null;
        tracking.currentPrice = currentPrice;
        tracking.lastChecked = new Date();
        tracking.updatedAt = new Date();
        await tracking.save();

        console.log(`[Cron] Current price for ${tracking.productName}: ₹${currentPrice}, Target: ₹${tracking.targetPrice}`);

        // Check if target price is reached (currentPrice <= targetPrice)
        if (currentPrice <= tracking.targetPrice) {
            console.log(`[Cron] 🎯 Target reached for ${tracking.productName}!`);

            // If not yet notified, send notification immediately
            if (!tracking.notified) {
                await sendPushNotification(tracking);
            } 
            // If already notified and repeatAlerts is enabled, check buffer to avoid spam
            else if (tracking.repeatAlerts) {
                // Add a 2% buffer to avoid notifications on small fluctuations
                const priceBuffer = tracking.targetPrice * 0.02;
                if (currentPrice <= (tracking.targetPrice - priceBuffer)) {
                    await sendPushNotification(tracking);
                } else {
                    console.log(`[Cron] Price within buffer range, not sending duplicate notification`);
                }
            } else {
                console.log(`[Cron] Already notified and repeat alerts disabled`);
            }
        }

    } catch (error) {
        console.error(`[Cron] Error checking ${tracking.productName}:`, error);
        tracking.failureCount += 1;
        tracking.lastError = error.message;
        tracking.updatedAt = new Date();
        await tracking.save();
    }
};

// Schedule price checks every hour
cron.schedule('0 * * * *', async () => {
    console.log(`[Cron] ============ Starting scheduled price check at ${new Date().toISOString()} ============`);

    try {
        const trackings = await Tracking.find({ isActive: true });
        console.log(`[Cron] Found ${trackings.length} active price alerts`);

        if (trackings.length === 0) {
            console.log('[Cron] No active alerts to check');
            return;
        }

        // Process alerts sequentially to avoid overwhelming the system
        for (const item of trackings) {
            try {
                await checkPriceForTracking(item);
                // Add a small delay between checks to be respectful to servers
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`[Cron] Failed to check ${item.productName}:`, error);
            }
        }

        console.log(`[Cron] ============ Completed scheduled price check ============`);
    } catch (error) {
        console.error('[Cron] Fatal error in scheduled job:', error);
    }
});

const PORT = 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
    const { userEmail, productName, currentPrice, targetPrice, url, platform, image } = req.body;
    console.log("[Backend] Received tracking request:", { userEmail, productName, url });

    try {
        const newTracking = new Tracking({
            userEmail,
            productName,
            currentPrice,
            targetPrice,
            url,
            platform,
            image
        });
        await newTracking.save();
        console.log(`[Backend] New product tracked: ${productName} for ${userEmail}`);
        res.status(201).json({ success: true, tracking: newTracking });
    } catch (error) {
        console.error("Tracking Error:", error);
        res.status(500).json({ message: "Error saving track", error });
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

// --- Background Price Monitor (Cron Job) ---
cron.schedule('0 * * * *', async () => {
    console.log("Running scheduled price check...");
    const trackings = await Tracking.find({ isActive: true });

    for (const item of trackings) {
        console.log(`Cron: Checking ${item.productName}...`);
    }
});

const PORT = 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    googleId: String,
    name: String,
    picture: String,
    createdAt: { type: Date, default: Date.now }
});

const trackingSchema = new mongoose.Schema({
    userEmail: { type: String, required: true, index: true },
    productName: String,
    currentPrice: Number,
    targetPrice: { type: Number, required: true },
    url: { type: String, required: true },
    platform: String,
    image: String,
    currency: { type: String, default: '₹' },
    isActive: { type: Boolean, default: true },
    lastChecked: Date,
    notified: { type: Boolean, default: false },
    notifiedAt: Date,
    repeatAlerts: { type: Boolean, default: false },
    failureCount: { type: Number, default: 0 },
    lastError: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Create a compound unique index to prevent duplicate alerts for same user+product
trackingSchema.index({ userEmail: 1, url: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Tracking = mongoose.model('Tracking', trackingSchema);

module.exports = { User, Tracking };

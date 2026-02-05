const mongoose = require('mongoose');

const trackingSchema = new mongoose.Schema({
    userEmail: { type: String, required: true, index: true },
    productName: String,
    currentPrice: Number,
    previousPrice: Number,  // Last observed price before current update
    targetPrice: { type: Number, required: true },
    url: { type: String, required: true },
    platform: String,
    image: String,
    currency: { type: String, default: '₹' },
    isActive: { type: Boolean, default: true },
    lastChecked: Date,
    notified: { type: Boolean, default: false },
    notifiedAt: Date,
    lastNotifiedPrice: Number,  // Track price at which notification was sent
    repeatAlerts: { type: Boolean, default: false },
    failureCount: { type: Number, default: 0 },
    lastError: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Create a compound unique index to prevent duplicate alerts for same user+product
trackingSchema.index({ userEmail: 1, url: 1 }, { unique: true });

module.exports = mongoose.model('Tracking', trackingSchema);

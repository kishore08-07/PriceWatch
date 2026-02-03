const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    googleId: String,
    name: String,
    picture: String,
    createdAt: { type: Date, default: Date.now }
});

const trackingSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    productName: String,
    currentPrice: Number,
    targetPrice: Number,
    url: { type: String, required: true },
    platform: String,
    image: String,
    currency: { type: String, default: '₹' },
    isActive: { type: Boolean, default: true },
    lastChecked: Date,
    notified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Tracking = mongoose.model('Tracking', trackingSchema);

module.exports = { User, Tracking };

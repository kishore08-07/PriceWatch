const express = require('express');
const authRoutes = require('./authRoutes');
const trackingRoutes = require('./trackingRoutes');
const reviewRoutes = require('./reviewRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/tracker', trackingRoutes);
router.use('/reviews', reviewRoutes);

module.exports = router;

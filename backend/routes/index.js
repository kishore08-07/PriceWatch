const express = require('express');
const authRoutes = require('./authRoutes');
const trackingRoutes = require('./trackingRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/tracker', trackingRoutes);

module.exports = router;

const express = require('express');
const authRoutes = require('./authRoutes');
const trackingRoutes = require('./trackingRoutes');
const reviewRoutes = require('./reviewRoutes');
const comparisonRoutes = require('./comparisonRoutes');
const whatsappRoutes = require('./whatsappRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/tracker', trackingRoutes);
router.use('/reviews', reviewRoutes);
router.use('/comparison', comparisonRoutes);
router.use('/whatsapp', whatsappRoutes);

module.exports = router;

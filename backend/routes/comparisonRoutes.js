/**
 * Price Comparison Routes
 * POST /api/comparison/compare — Cross-site price comparison
 */

const express = require('express');
const { compareProduct } = require('../services/priceComparisonService');

const router = express.Router();

/**
 * POST /api/comparison/compare
 *
 * Body: { title, brand?, model?, price, platform, url }
 * Returns: { success, results: [...], searchQuery, fromCache, comparedAt }
 */
router.post('/compare', async (req, res) => {
    const startTime = Date.now();

    try {
        const { title, brand, model, price, platform, url } = req.body;

        // Validate required fields
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Product title is required'
            });
        }

        if (!platform || typeof platform !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Source platform is required'
            });
        }

        const validPlatforms = ['Amazon', 'Flipkart', 'Reliance Digital'];
        if (!validPlatforms.includes(platform)) {
            return res.status(400).json({
                success: false,
                error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`
            });
        }

        console.log(`[ComparisonRoute] Compare request for "${title}" on ${platform}`);

        const result = await compareProduct({
            title: title.trim(),
            brand: brand?.trim() || '',
            model: model?.trim() || '',
            price: price || null,
            platform,
            url: url || ''
        });

        const processingTimeMs = Date.now() - startTime;

        return res.json({
            success: true,
            ...result,
            processingTimeMs
        });

    } catch (error) {
        console.error('[ComparisonRoute] Error:', error.message);

        const processingTimeMs = Date.now() - startTime;

        return res.status(500).json({
            success: false,
            error: error.message || 'Price comparison failed',
            processingTimeMs
        });
    }
});

module.exports = router;

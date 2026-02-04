const axios = require('axios');
const { extractPriceFromHtml } = require('../utils/priceExtractor');
const { SCRAPE_TIMEOUT } = require('../config/constants');

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const scrapeProductPrice = async (url, retryCount = 0) => {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: SCRAPE_TIMEOUT,
            maxRedirects: 5
        });

        const html = response.data;
        const price = extractPriceFromHtml(html);

        if (price === null) {
            throw new Error('Price not found in HTML');
        }

        return price;
    } catch (error) {
        console.error(`Scraping error for ${url} (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error.message);
        
        // Retry logic
        if (retryCount < MAX_RETRIES - 1) {
            // Check if error is retryable
            const isRetryable = 
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ECONNREFUSED' ||
                error.response?.status === 429 || // Rate limited
                error.response?.status >= 500;    // Server error
            
            if (isRetryable) {
                console.log(`[Scraper] Retrying in ${RETRY_DELAY}ms...`);
                await delay(RETRY_DELAY * (retryCount + 1)); // Exponential backoff
                return scrapeProductPrice(url, retryCount + 1);
            }
        }
        
        throw new Error(`Failed to scrape after ${retryCount + 1} attempts: ${error.message}`);
    }
};

module.exports = { scrapeProductPrice };

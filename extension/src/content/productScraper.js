import { scrapeAmazon } from './scrapers/amazonScraper';
import { scrapeFlipkart } from './scrapers/flipkartScraper';
import { scrapeRelianceDigital } from './scrapers/relianceDigitalScraper';

export const getProductData = () => {
    const url = window.location.href;
    let data = null;

    if (url.includes('amazon.')) {
        data = scrapeAmazon();
    } else if (url.includes('flipkart.com')) {
        data = scrapeFlipkart();
    } else if (url.includes('reliancedigital.in')) {
        data = scrapeRelianceDigital();
    }

    if (data) {
        data.url = url; // Add the URL to the product data
    }

    return data;
};

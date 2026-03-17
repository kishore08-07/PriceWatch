import { scrapeAmazon } from './scrapers/amazonScraper';
import { scrapeAmazonExtended } from './scrapers/amazonScraper';
import { scrapeFlipkart } from './scrapers/flipkartScraper';
import { scrapeFlipkartExtended } from './scrapers/flipkartScraper';
import { scrapeRelianceDigital } from './scrapers/relianceDigitalScraper';
import { scrapeRelianceDigitalExtended } from './scrapers/relianceDigitalScraper';

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

export const getProductDataExtended = () => {
    const url = window.location.href;
    let data = null;

    if (url.includes('amazon.')) {
        data = scrapeAmazonExtended();
    } else if (url.includes('flipkart.com')) {
        data = scrapeFlipkartExtended();
    } else if (url.includes('reliancedigital.in')) {
        data = scrapeRelianceDigitalExtended();
    }

    if (data) {
        data.url = url;
    }

    return data;
};


import { getScopedElement, trimPrice } from '../utils/priceParser';
import { extractImage } from '../utils/imageExtractor';
import { checkAvailability } from '../utils/availabilityChecker';
import { AMAZON_SELECTORS } from '../selectors/amazonSelectors';

export const scrapeAmazon = () => {
    const { containers, name: nameSelectors, price: priceSelectors, unavailability, unavailabilityKeywords, image: imageSelectors } = AMAZON_SELECTORS;

    const available = checkAvailability(unavailability, unavailabilityKeywords);
    const name = getScopedElement(containers, nameSelectors, 'name');
    const priceText = getScopedElement(containers, priceSelectors, 'price', true);
    const image = extractImage(imageSelectors);

    return {
        name,
        price: available ? trimPrice(priceText) : null,
        platform: 'Amazon',
        image,
        currency: '₹',
        available
    };
};

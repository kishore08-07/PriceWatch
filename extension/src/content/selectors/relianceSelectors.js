export const RELIANCE_SELECTORS = {
    containers: ['.product-right-container', '.product-description-container', '.pdp-main-product', 'main'],
    name: [
        'h1.product-name',
        'h1#main-content',
        '.header-container h1',
        'h1[tabindex="0"]',
        '.pdp__title',
        '#pdp_product_title',
        'h1'
    ],
    price: [
        '.add-to-cart-container__product-price',
        '.add-to-card-container__product-price',
        'div.product-price',
        '.product-price-wrapper .product-price',
        '.pdp__priceSection [class*="price"]',
        '[data-testid*="price"]',
        '[data-label="MRP"] + *',
        'span[class*="mrp"]',
        '.pdp__offerPrice',
        '.pdp__priceSection__price',
        '#pdp_price',
        '.price',
        'div[class*="price"]'
    ],
    unavailabilityKeywords: ['out of stock', 'currently unavailable', 'sold out', 'no longer available'],
    image: [
        'img.pdp-image',
        '.image-item img',
        '.load-image img',
        'img[data-v-597ac81e]',
        'img[src*="cdn.jiostore.online"]',
        'img[src*="cdn.pixelpinch"]',
        '#pdp_main_image',
        '.pdp__mainImage',
        'img[src*="reliancedigital"]',
        '.product-image img',
        '.main-image img',
        'img[alt*="product"]',
        'div[class*="image"] img'
    ]
};

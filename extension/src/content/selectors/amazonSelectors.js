export const AMAZON_SELECTORS = {
    containers: ['#ppd', '#centerCol', '#rightCol', '#dp-container'],
    name: ['#productTitle', '#title', '.qa-title-text'],
    price: ['.a-price-whole', '#priceblock_ourprice', '#priceblock_dealprice', '.a-price.a-text-price.a-size-medium .a-offscreen', '.apexPriceToPay .a-offscreen'],
    unavailability: [
        '#availability .a-color-price',
        '#availability .a-color-state',
        '#availability span'
    ],
    unavailabilityKeywords: ['unavailable', 'out of stock', 'currently unavailable', 'not available'],
    image: [
        '#landingImage',
        '#imgBlkFront',
        '#main-image',
        '#imgTagWrapperId img',
        '#altImages + div img',
        '.imgTagWrapper img',
        'img[data-old-hires]',
        'img.a-dynamic-image'
    ]
};

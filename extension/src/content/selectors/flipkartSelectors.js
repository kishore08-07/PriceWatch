export const FLIPKART_SELECTORS = {
    // Add more generic containers and selectors for resilience
    containers: ['#container', 'body', '.WsoCM9', '.dyCpxm', '._2c2S6L'],
    name: [
        'h1', // Any h1
        'h1 span',
        'h1.CEn5rD span', 'h1.CEn5rD', 'h1.VU-Z7G', '.B_NuCI',
        '[data-tkid], [data-id], [data-product-id]', // Fallbacks
    ],
    price: [
        '[class*="price"]',
        '[class*="Price"]',
        '[class*="_30jeq3"]',
        '[class*="Nx9SaT"]',
        '[class*="_16Jk6d"]',
        '[class*="_25b18c"]',
        '[aria-label*="₹"]',
        '*:not(script):not(style):not(meta):not(link)', // Fallback: any element
    ],
    unavailabilityKeywords: ['currently unavailable', 'out of stock', 'sold out'],
    image: [
        'img[src*="flipkart.com/image/"]',
        'img[src*="rukminim"]',
        'img[loading="eager"][src*="rukminim"]',
        'img',
        '.CXW8mj img',
        '._396cs4 img',
        '._2r_T1_ img',
        '._1AtV9z img',
        'div[class*="image"] img',
    ]
};

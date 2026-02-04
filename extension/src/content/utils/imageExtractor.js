export const extractImage = (selectors) => {
    for (const selector of selectors) {
        const imgEl = document.querySelector(selector);
        if (imgEl?.src && !imgEl.src.includes('transparent-pixel') && !imgEl.src.includes('data:image') && imgEl.width > 50) {
            return imgEl.src;
        }
    }
    return null;
};

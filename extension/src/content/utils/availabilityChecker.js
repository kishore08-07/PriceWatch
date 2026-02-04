export const checkAvailability = (unavailabilitySelectors, keywords) => {
    for (const selector of unavailabilitySelectors) {
        const element = document.querySelector(selector);
        if (element) {
            const text = element.innerText.toLowerCase();
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    return false;
                }
            }
        }
    }
    return true;
};

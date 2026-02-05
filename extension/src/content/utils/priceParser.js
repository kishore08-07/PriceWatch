export const trimPrice = (str) => {
    if (!str) return null;
    const match = str.replace(/,/g, '').match(/[0-9.]+/);
    if (!match) return null;
    const value = parseFloat(match[0]);
    return isNaN(value) ? null : Math.floor(value);
};

export const findPriceByHeuristic = (container = document) => {
    const elements = Array.from(container.querySelectorAll('*'));
    for (const el of elements) {
        if (el.children.length === 0 && el.innerText) {
            const text = el.innerText.trim();
            if (text.startsWith('₹') && text.length > 1 && text.length < 20) {
                const price = trimPrice(text);
                if (price && price > 100) return text;
            }
        }
        const label = el.getAttribute && el.getAttribute('aria-label');
        if (label && label.startsWith('₹') && label.length < 20) {
            const price = trimPrice(label);
            if (price && price > 100) return label;
        }
    }
    return null;
};

export const getScopedElement = (containerSelectors, elementSelectors, fieldName, isPrice = false) => {
    for (const cSelector of containerSelectors) {
        const container = document.querySelector(cSelector);
        if (container) {
            for (const eSelector of elementSelectors) {
                const el = container.querySelector(eSelector);
                if (el) {
                    const text = el.innerText && el.innerText.trim();
                    if (text) return text;
                    const label = el.getAttribute && el.getAttribute('aria-label');
                    if (label && label.includes('₹')) return label;
                }
            }
            if (isPrice) {
                const heuristicPrice = findPriceByHeuristic(container);
                if (heuristicPrice) return heuristicPrice;
            }
        }
    }
    for (const eSelector of elementSelectors) {
        const el = document.querySelector(eSelector);
        if (el) {
            const text = el.innerText && el.innerText.trim();
            if (text) return text;
            const label = el.getAttribute && el.getAttribute('aria-label');
            if (label && label.includes('₹')) return label;
        }
    }
    if (isPrice) {
        const heuristicPrice = findPriceByHeuristic();
        if (heuristicPrice) return heuristicPrice;
    }
    return null;
};

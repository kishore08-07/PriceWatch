/**
 * Debug: dump raw HTML from Flipkart and Reliance Digital search pages
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

async function dumpPages() {
    const query = 'Samsung Galaxy S24 Ultra';

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    // === Flipkart ===
    console.log('--- Flipkart ---');
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
        console.log('URL:', url);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Close login popup if present
        await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.innerText && b.innerText.includes('✕')) b.click();
            }
            // Try known close button
            const closeBtn = document.querySelector('button._2KpZ6l._2doB4z');
            if (closeBtn) closeBtn.click();
        }).catch(() => { });

        await new Promise(r => setTimeout(r, 3000));

        const html = await page.content();
        fs.writeFileSync('/tmp/flipkart-search.html', html);
        console.log(`Saved ${html.length} chars to /tmp/flipkart-search.html`);

        // Quick analysis of what elements exist
        const analysis = await page.evaluate(() => {
            const results = {};
            // Check for common product card containers
            results.dataId = document.querySelectorAll('[data-id]').length;
            results.a_with_p = document.querySelectorAll('a[href*="/p/"]').length;
            results.tUxRFH = document.querySelectorAll('.tUxRFH').length;
            results.cPHDOP = document.querySelectorAll('.cPHDOP').length;
            results._75nlfW = document.querySelectorAll('._75nlfW').length;
            results._1AtVbE = document.querySelectorAll('._1AtVbE').length;
            results.yKfJKb = document.querySelectorAll('.yKfJKb').length;
            results.slAVV4 = document.querySelectorAll('.slAVV4').length;
            results.CGtC98 = document.querySelectorAll('.CGtC98').length;
            results.DOjaWF = document.querySelectorAll('.DOjaWF').length;
            results.KzDlHZ = document.querySelectorAll('.KzDlHZ').length;
            results.Nx9SaT = document.querySelectorAll('._30jeq3').length;
            results.Nx9bqj = document.querySelectorAll('.Nx9bqj').length;
            results.wjcEIp = document.querySelectorAll('.wjcEIp').length;
            results.all_divs_with_rupee = Array.from(document.querySelectorAll('div, span')).filter(e => e.innerText && e.innerText.includes('₹') && e.children.length === 0).length;

            // Get first 3 product links
            const links = Array.from(document.querySelectorAll('a[href*="/p/"]')).slice(0, 3);
            results.sampleLinks = links.map(a => ({
                href: a.href,
                title: a.getAttribute('title') || a.innerText?.substring(0, 50),
                parentClass: a.parentElement?.className?.substring(0, 40),
                grandparentClass: a.parentElement?.parentElement?.className?.substring(0, 40),
            }));

            return results;
        });
        console.log('Flipkart analysis:', JSON.stringify(analysis, null, 2));

        await page.close();
    } catch (err) {
        console.error('Flipkart error:', err.message);
    }

    // === Reliance Digital ===
    console.log('\n--- Reliance Digital ---');
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = `https://www.reliancedigital.in/search?q=${encodeURIComponent(query)}`;
        console.log('URL:', url);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

        await new Promise(r => setTimeout(r, 4000));

        const html = await page.content();
        fs.writeFileSync('/tmp/reliance-search.html', html);
        console.log(`Saved ${html.length} chars to /tmp/reliance-search.html`);

        const analysis = await page.evaluate(() => {
            const results = {};
            results.sp__product = document.querySelectorAll('.sp__product').length;
            results.product_card = document.querySelectorAll('.product-card').length;
            results.sp_product_card = document.querySelectorAll('.sp-product-card').length;
            results.data_pid = document.querySelectorAll('[data-pid]').length;
            results.a_with_p = document.querySelectorAll('a[href*="/p/"]').length;
            results.all_divs_with_rupee = Array.from(document.querySelectorAll('div, span')).filter(e => e.innerText && e.innerText.includes('₹') && e.children.length === 0).length;

            // Alternative: look for any product-like grid
            results.productItems = document.querySelectorAll('[class*="product"]').length;
            results.cardItems = document.querySelectorAll('[class*="card"]').length;
            results.gridItems = document.querySelectorAll('[class*="grid"]').length;

            // Get sample product links
            const links = Array.from(document.querySelectorAll('a[href*="/p/"]')).slice(0, 3);
            results.sampleLinks = links.map(a => ({
                href: a.href,
                text: a.innerText?.substring(0, 60),
                parentClass: a.parentElement?.className?.substring(0, 50),
            }));

            // Check if the page even loaded search results
            results.bodyLength = document.body.innerText.length;
            results.bodySnapshot = document.body.innerText.substring(0, 500);

            return results;
        });
        console.log('Reliance analysis:', JSON.stringify(analysis, null, 2));

        await page.close();
    } catch (err) {
        console.error('Reliance error:', err.message);
    }

    await browser.close();
    console.log('\nDone.');
}

dumpPages().catch(console.error);

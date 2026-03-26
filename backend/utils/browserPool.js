/**
 * Puppeteer Browser Pool
 * ======================
 * Shared pool of Chromium browser instances for all scrapers.
 *
 * WHY: Each scraper call previously spawned its own `puppeteer.launch()`, taking
 * 3–5 s per invocation and creating 6–9 browser processes during a single price
 * comparison (3 query variants × 2–3 platforms). Under concurrent user load this
 * exhausts RAM and CPU on the server.
 *
 * HOW: `generic-pool` manages a warm-standby pool of `min` browser instances,
 * creating more on demand up to `max`. Scrapers acquire a browser from the pool,
 * open ONE new page, extract data, close the page, then release the browser back.
 * The browser process stays alive and is reused, eliminating restart overhead.
 *
 * Configuration (via environment variables):
 *   BROWSER_POOL_MIN   — minimum browsers to keep warm (default: 1)
 *   BROWSER_POOL_MAX   — maximum concurrent browsers (default: 3)
 *   BROWSER_IDLE_MS    — idle timeout before evicting a browser (default: 60000)
 */

'use strict';

const puppeteer = require('puppeteer');
const { createPool } = require('generic-pool');

const POOL_MIN = parseInt(process.env.BROWSER_POOL_MIN || '1', 10);
const POOL_MAX = parseInt(process.env.BROWSER_POOL_MAX || '3', 10);
const POOL_IDLE_MS = parseInt(process.env.BROWSER_IDLE_MS || '60000', 10);

// Shared Puppeteer launch args — applied to every browser in the pool.
const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1366,768',
    '--disable-features=TranslateUI',
    '--disable-extensions',
];

const factory = {
    /**
     * Create a new browser instance. Called by the pool whenever supply < demand.
     */
    create: async () => {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: LAUNCH_ARGS,
        });
        console.log('[BrowserPool] Created browser (pid:', browser.process()?.pid, ')');
        return browser;
    },

    /**
     * Destroy a browser instance. Called when the pool evicts an idle browser
     * or when the pool is draining on server shutdown.
     */
    destroy: async (browser) => {
        console.log('[BrowserPool] Destroying browser (pid:', browser.process()?.pid, ')');
        await browser.close().catch(() => { /* already closed */ });
    },

    /**
     * Validate that the browser is still responsive before lending it out.
     * A browser that crashed or was closed externally will fail this check and
     * be evicted automatically.
     */
    validate: async (browser) => {
        try {
            // `pages()` throws / rejects if the browser process is dead.
            await browser.pages();
            return true;
        } catch {
            return false;
        }
    },
};

const browserPool = createPool(factory, {
    min: POOL_MIN,
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_MS,
    acquireTimeoutMillis: 30_000,   // Wait up to 30 s to get a browser from pool
    testOnBorrow: true,             // Run factory.validate before lending
    evictionRunIntervalMillis: 15_000,
});

browserPool.on('factoryCreateError', (err) => {
    console.error('[BrowserPool] Failed to create browser:', err.message);
});

browserPool.on('factoryDestroyError', (err) => {
    console.error('[BrowserPool] Failed to destroy browser:', err.message);
});

console.log(`[BrowserPool] Initialized (min=${POOL_MIN}, max=${POOL_MAX}, idle=${POOL_IDLE_MS}ms)`);

/**
 * Acquire a browser from the pool, run `fn(browser)`, then release.
 * Ensures the browser is always returned to the pool even if `fn` throws.
 *
 * @template T
 * @param {function(import('puppeteer').Browser): Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withBrowser(fn) {
    const browser = await browserPool.acquire();
    try {
        return await fn(browser);
    } finally {
        // Always release — never destroy — so the browser stays warm.
        browserPool.release(browser);
    }
}

/**
 * Drain and destroy all pool resources. Call on graceful server shutdown.
 */
async function drainPool() {
    console.log('[BrowserPool] Draining pool…');
    await browserPool.drain();
    await browserPool.clear();
    console.log('[BrowserPool] Pool drained.');
}

module.exports = { browserPool, withBrowser, drainPool };

/**
 * Python NLP Client
 * =================
 * Lightweight HTTP client for communicating with the PriceWatch Python AI Service.
 *
 * Features:
 *   - Zero external dependencies (uses Node's built-in `http` module)
 *   - Configurable timeout and retry logic (exponential back-off)
 *   - Descriptive errors that help the developer fix connectivity issues
 *
 * Environment variables:
 *   PYTHON_SERVICE_URL   — default: http://localhost:5001
 *   PYTHON_TIMEOUT_MS    — per-request timeout in ms (default: 30000)
 *   PYTHON_MAX_RETRIES   — number of additional attempts (default: 2)
 */

'use strict';

const http = require('http');

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';

const REQUEST_TIMEOUT_MS = parseInt(
  process.env.PYTHON_TIMEOUT_MS || '300000',
  10
);

const MAX_RETRIES = parseInt(process.env.PYTHON_MAX_RETRIES || '1', 10);

// ── Health check ─────────────────────────────────────────────────────────────

/**
 * Check whether the Python AI service is reachable.
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    const result = await _request('GET', '/health', null, 5000);
    return result?.status === 'ok';
  } catch {
    return false;
  }
}

// ── Main inference call ───────────────────────────────────────────────────────

/**
 * Send reviews to the Python AI service for full NLP analysis.
 *
 * @param {Array<{text:string, rating:number, author?:string, title?:string, date?:string, helpfulCount?:number}>} reviews
 * @param {{ platform?: string, productId?: string }} [meta]
 * @returns {Promise<{
 *   success: boolean,
 *   summary: string,
 *   pros: string[],
 *   cons: string[],
 *   sentimentDistribution: { positive:number, neutral:number, negative:number, total:number },
 *   sentimentScore: number,
 *   totalReviews: number,
 *   processingTimeMs: number
 * }>}
 * @throws {Error} When the service is unavailable after all retries
 */
async function analyzeReviews(reviews, meta = {}) {
  const payload = {
    reviews,
    platform: meta.platform || 'unknown',
    productId: meta.productId || '',
  };

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      console.log(
        `[PythonNlpClient] Attempt ${attempt}: sending ${reviews.length} reviews for analysis`
      );
      const result = await _request(
        'POST',
        '/analyze',
        payload,
        REQUEST_TIMEOUT_MS
      );
      console.log(
        `[PythonNlpClient] Success on attempt ${attempt} — ${result.processingTimeMs}ms`
      );
      return result;
    } catch (err) {
      lastError = err;
      console.warn(
        `[PythonNlpClient] Attempt ${attempt} failed: ${err.message}`
      );
      if (attempt <= MAX_RETRIES) {
        // Exponential back-off: 500 ms, 1000 ms, …
        await _sleep(500 * attempt);
      }
    }
  }

  throw new Error(
    `Python AI service unavailable after ${MAX_RETRIES + 1} attempt(s): ${lastError?.message}`
  );
}

// ── Internal HTTP helper (no external deps) ───────────────────────────────────

/**
 * Make an HTTP request to the Python service.
 *
 * @param {string} method   HTTP method
 * @param {string} path     Endpoint path
 * @param {Object|null} body Request body (will be JSON-serialised)
 * @param {number} timeoutMs Timeout in milliseconds
 * @returns {Promise<Object>} Parsed JSON response
 */
function _request(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(PYTHON_SERVICE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: parseInt(url.port || '5001', 10),
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(bodyStr
          ? { 'Content-Length': Buffer.byteLength(bodyStr) }
          : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(
              new Error(
                `Python service HTTP ${res.statusCode}: ${
                  parsed.detail || parsed.message || data.substring(0, 200)
                }`
              )
            );
          } else {
            resolve(parsed);
          }
        } catch {
          reject(
            new Error(
              `Invalid JSON from Python service: ${data.substring(0, 200)}`
            )
          );
        }
      });
    });

    // Socket-level timeout
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(`Python service request timed out after ${timeoutMs}ms`)
      );
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(
          new Error(
            'Python AI service is not running. ' +
              'Start it with: cd ai-service && uvicorn app:app --port 5001'
          )
        );
      } else {
        reject(err);
      }
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { analyzeReviews, checkHealth };

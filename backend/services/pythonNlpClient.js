/**
 * Python NLP Client — Production Build
 * ======================================
 * HTTP client for communicating with the PriceWatch Python AI Service.
 *
 * Features:
 *   - Zero external dependencies (Node built-in `http`)
 *   - Configurable timeout and retry (exponential back-off)
 *   - Circuit breaker — stops hammering a dead service
 *   - Request-level abort controller
 *   - Descriptive error messages with fix hints
 *
 * Environment variables:
 *   PYTHON_SERVICE_URL   — default: http://localhost:5001
 *   PYTHON_TIMEOUT_MS    — per-request timeout (default: 300000 = 5 min)
 *   PYTHON_MAX_RETRIES   — additional attempts  (default: 1)
 */

'use strict';

const http = require('http');

// ── Configuration ─────────────────────────────────────────────────────────────

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';
const REQUEST_TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS || '300000', 10);
const MAX_RETRIES = parseInt(process.env.PYTHON_MAX_RETRIES || '1', 10);

// ── Circuit Breaker ──────────────────────────────────────────────────────────

/**
 * Simple circuit breaker to avoid hammering a dead Python service.
 *
 * States:
 *   CLOSED  → Normal operation (requests pass through)
 *   OPEN    → Service is down, reject immediately
 *   HALF    → Allow one probe request to test if service recovered
 *
 * Transitions:
 *   CLOSED → OPEN    after `failureThreshold` consecutive failures
 *   OPEN   → HALF    after `resetTimeoutMs` elapses
 *   HALF   → CLOSED  if probe succeeds
 *   HALF   → OPEN    if probe fails
 */
const _circuit = {
  state: 'CLOSED',           // CLOSED | OPEN | HALF_OPEN
  failures: 0,
  lastFailureTime: 0,
  failureThreshold: 3,       // consecutive failures before opening
  resetTimeoutMs: 30_000,    // 30s before retrying after circuit opens
  lastError: null,
};

function _circuitAllowRequest() {
  if (_circuit.state === 'CLOSED') return true;
  if (_circuit.state === 'OPEN') {
    if (Date.now() - _circuit.lastFailureTime >= _circuit.resetTimeoutMs) {
      _circuit.state = 'HALF_OPEN';
      console.log('[PythonNlpClient] Circuit → HALF_OPEN (probing…)');
      return true; // allow one probe
    }
    return false; // still cooling down
  }
  // HALF_OPEN — one request already in flight
  return false;
}

function _circuitOnSuccess() {
  if (_circuit.state !== 'CLOSED') {
    console.log('[PythonNlpClient] Circuit → CLOSED (service recovered)');
  }
  _circuit.state = 'CLOSED';
  _circuit.failures = 0;
  _circuit.lastError = null;
}

function _circuitOnFailure(err) {
  _circuit.failures++;
  _circuit.lastFailureTime = Date.now();
  _circuit.lastError = err.message;

  if (_circuit.state === 'HALF_OPEN' || _circuit.failures >= _circuit.failureThreshold) {
    _circuit.state = 'OPEN';
    console.warn(
      `[PythonNlpClient] Circuit → OPEN after ${_circuit.failures} failure(s). ` +
      `Next probe in ${_circuit.resetTimeoutMs / 1000}s. Last error: ${err.message}`
    );
  }
}

// ── Health check ──────────────────────────────────────────────────────────────

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

/**
 * Get detailed health info from the Python service.
 * @returns {Promise<Object|null>}
 */
async function getHealthDetails() {
  try {
    return await _request('GET', '/health', null, 5000);
  } catch {
    return null;
  }
}

/**
 * Get circuit breaker status (for diagnostics / health endpoint).
 */
function getCircuitStatus() {
  return {
    state: _circuit.state,
    consecutiveFailures: _circuit.failures,
    lastError: _circuit.lastError,
    lastFailureTime: _circuit.lastFailureTime
      ? new Date(_circuit.lastFailureTime).toISOString()
      : null,
  };
}

// ── Main inference call ───────────────────────────────────────────────────────

/**
 * Send reviews to the Python AI service for full NLP analysis.
 *
 * @param {Array<{text:string, rating:number, author?:string, title?:string, date?:string}>} reviews
 * @param {{ platform?: string, productId?: string }} [meta]
 * @returns {Promise<Object>} Structured analysis result
 * @throws {Error} When service unavailable or circuit open
 */
async function analyzeReviews(reviews, meta = {}) {
  // Circuit breaker gate
  if (!_circuitAllowRequest()) {
    const retryIn = Math.max(
      0,
      _circuit.resetTimeoutMs - (Date.now() - _circuit.lastFailureTime)
    );
    throw new Error(
      `Python AI service circuit is OPEN (${_circuit.failures} consecutive failures). ` +
      `Retry in ${Math.ceil(retryIn / 1000)}s. Last error: ${_circuit.lastError || 'unknown'}`
    );
  }

  const payload = {
    reviews,
    platform: meta.platform || 'unknown',
    productId: meta.productId || '',
  };

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const t0 = Date.now();
      console.log(
        `[PythonNlpClient] Attempt ${attempt}: sending ${reviews.length} reviews for analysis`
      );

      const result = await _request('POST', '/analyze', payload, REQUEST_TIMEOUT_MS);

      const elapsed = Date.now() - t0;
      console.log(
        `[PythonNlpClient] ✅ Success on attempt ${attempt} — ${elapsed}ms ` +
        `(${result.totalAnalyzed || result.totalReviews} analyzed, score=${result.sentimentScore})`
      );

      _circuitOnSuccess();
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[PythonNlpClient] ❌ Attempt ${attempt} failed: ${err.message}`);

      if (attempt <= MAX_RETRIES) {
        const backoff = 500 * attempt;
        console.log(`[PythonNlpClient] Retrying in ${backoff}ms…`);
        await _sleep(backoff);
      }
    }
  }

  _circuitOnFailure(lastError);

  throw new Error(
    `Python AI service unavailable after ${MAX_RETRIES + 1} attempt(s): ${lastError?.message}`
  );
}

// ── Internal HTTP helper ──────────────────────────────────────────────────────

/**
 * Make an HTTP request to the Python service.
 *
 * @param {string} method   HTTP method
 * @param {string} path     Endpoint path
 * @param {Object|null} body Request body (JSON-serialized)
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
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(
              new Error(
                `Python service HTTP ${res.statusCode}: ${
                  parsed.detail || parsed.message || parsed.error || data.substring(0, 300)
                }`
              )
            );
          } else {
            resolve(parsed);
          }
        } catch {
          reject(
            new Error(`Invalid JSON from Python service: ${data.substring(0, 300)}`)
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
      } else if (err.code === 'ECONNRESET') {
        reject(
          new Error(
            'Python AI service connection was reset (possibly OOM or crash). ' +
            'Check the AI service logs.'
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

module.exports = {
  analyzeReviews,
  checkHealth,
  getHealthDetails,
  getCircuitStatus,
};

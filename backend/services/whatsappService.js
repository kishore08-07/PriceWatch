const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { EventEmitter } = require('events');

const SESSION_DIR = path.join(__dirname, '..', '.whatsapp-session');
const RECONNECT_MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 5000;
const MESSAGE_RATE_LIMIT_MS = 2000; // Min gap between messages to avoid bans

class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.qrCode = null;
        this.reconnectAttempts = 0;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.lastMessageTime = 0;
    }

    /**
     * Initialize the WhatsApp connection using Baileys.
     * Call this once on server startup or via an admin endpoint.
     * The first time, it will generate a QR code to scan.
     */
    async initialize() {
        if (this.isConnecting) {
            console.log('[WhatsApp] Already connecting, skipping...');
            return;
        }

        this.isConnecting = true;

        try {
            // Ensure session directory exists
            if (!fs.existsSync(SESSION_DIR)) {
                fs.mkdirSync(SESSION_DIR, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
            const { version } = await fetchLatestBaileysVersion();

            this.socket = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: 'silent' }), // Reduce noise; set to 'info' for debugging
                browser: ['PriceWatch', 'Chrome', '1.0.0'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: false // Don't show as "online" to avoid suspicion
            });

            // --- Event: Connection Update ---
            this.socket.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qrCode = qr;
                    console.log('[WhatsApp] 📱 QR Code generated. Scan with WhatsApp to connect.');
                    qrcode.generate(qr, { small: true });
                    console.log('[WhatsApp] If QR is not visible, use GET /api/whatsapp/qr.');
                    this.emit('qr', qr);
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    this.isConnecting = false;
                    this.qrCode = null;

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    console.log(`[WhatsApp] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

                    if (shouldReconnect && this.reconnectAttempts < RECONNECT_MAX_RETRIES) {
                        this.reconnectAttempts++;
                        console.log(`[WhatsApp] Reconnecting... Attempt ${this.reconnectAttempts}/${RECONNECT_MAX_RETRIES}`);
                        setTimeout(() => this.initialize(), RECONNECT_DELAY_MS * this.reconnectAttempts);
                    } else if (!shouldReconnect) {
                        console.log('[WhatsApp] ❌ Logged out. Please re-scan QR code.');
                        this.clearSession();
                        this.emit('logged_out');
                    } else {
                        console.log('[WhatsApp] ❌ Max reconnect attempts reached.');
                        this.emit('max_retries');
                    }
                }

                if (connection === 'open') {
                    this.isConnected = true;
                    this.isConnecting = false;
                    this.reconnectAttempts = 0;
                    this.qrCode = null;
                    console.log('[WhatsApp] ✅ Connected successfully!');
                    this.emit('connected');
                    this._processQueue(); // Process any queued messages
                }
            });

            // --- Event: Credentials Update (persist session) ---
            this.socket.ev.on('creds.update', saveCreds);

        } catch (error) {
            this.isConnecting = false;
            console.error('[WhatsApp] ❌ Initialization error:', error.message);
            throw error;
        }
    }

    /**
     * Send a WhatsApp text message.
     * Phone number must be in format: countrycode + number (e.g., "919876543210")
     */
    async sendMessage(phoneNumber, message) {
        if (!this.isConnected || !this.socket) {
            console.warn('[WhatsApp] Not connected. Queuing message.');
            this.messageQueue.push({ phoneNumber, message });
            return { success: false, reason: 'Not connected', queued: true };
        }

        // Sanitize phone number — remove +, spaces, dashes
        const sanitized = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
        const jid = `${sanitized}@s.whatsapp.net`;

        try {
            // Check if the number is registered on WhatsApp
            let results;
            try {
                results = await this.socket.onWhatsApp(jid);
            } catch (lookupErr) {
                console.warn(`[WhatsApp] onWhatsApp lookup failed: ${lookupErr.message}`);
                // Treat lookup failure as unregistered to avoid sending to unknown JID
                return { success: false, reason: `Number lookup failed: ${lookupErr.message}` };
            }
            const result = results && results[0];
            if (!result || !result.exists) {
                console.warn(`[WhatsApp] Number ${sanitized} is not registered on WhatsApp.`);
                return { success: false, reason: 'Number not registered on WhatsApp' };
            }

            // Rate limiting — enforce minimum gap between messages
            const now = Date.now();
            const timeSinceLastMsg = now - this.lastMessageTime;
            if (timeSinceLastMsg < MESSAGE_RATE_LIMIT_MS) {
                await new Promise(resolve => setTimeout(resolve, MESSAGE_RATE_LIMIT_MS - timeSinceLastMsg));
            }

            await this.socket.sendMessage(result.jid, { text: message });
            this.lastMessageTime = Date.now();

            console.log(`[WhatsApp] ✅ Message sent to ${sanitized}`);
            return { success: true };

        } catch (error) {
            console.error(`[WhatsApp] ❌ Failed to send message to ${sanitized}:`, error.message);

            // Queue for retry if it's a connection issue
            if (error.message?.includes('connection') || error.message?.includes('timed out')) {
                this.messageQueue.push({ phoneNumber, message });
                return { success: false, reason: error.message, queued: true };
            }

            return { success: false, reason: error.message };
        }
    }

    /**
     * Check if a phone number is registered on WhatsApp.
     */
    async isRegisteredOnWhatsApp(phoneNumber) {
        if (!this.isConnected || !this.socket) {
            return { registered: false, reason: 'WhatsApp not connected' };
        }

        const sanitized = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
        const jid = `${sanitized}@s.whatsapp.net`;

        try {
            const results = await this.socket.onWhatsApp(jid);
            const result = results && results[0];
            return { registered: !!(result && result.exists), jid: result?.jid };
        } catch (error) {
            console.error(`[WhatsApp] Error checking number ${sanitized}:`, error.message);
            return { registered: false, reason: error.message };
        }
    }

    /**
     * Process the message queue (called when connection is restored).
     * Snapshots the queue to avoid infinite loop if sendMessage re-queues.
     */
    async _processQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        this.isProcessingQueue = true;

        // Snapshot: take the current queue items and clear the queue.
        // Any new failures during processing will re-queue but won't
        // be retried in this same pass, preventing an infinite loop.
        const batch = this.messageQueue.splice(0, this.messageQueue.length);
        console.log(`[WhatsApp] Processing ${batch.length} queued messages...`);

        for (const { phoneNumber, message } of batch) {
            try {
                await this.sendMessage(phoneNumber, message);
            } catch (error) {
                console.error(`[WhatsApp] Failed to send queued message:`, error.message);
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Get connection status.
     */
    getStatus() {
        return {
            connected: this.isConnected,
            connecting: this.isConnecting,
            hasQR: !!this.qrCode,
            queueSize: this.messageQueue.length,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    /**
     * Get the current QR code (for pairing via API endpoint).
     */
    getQRCode() {
        return this.qrCode;
    }

    /**
     * Clear session data (force re-authentication).
     */
    clearSession() {
        try {
            if (fs.existsSync(SESSION_DIR)) {
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                console.log('[WhatsApp] Session data cleared.');
            }
        } catch (error) {
            console.error('[WhatsApp] Error clearing session:', error.message);
        }
    }

    /**
     * Gracefully disconnect.
     */
    async disconnect() {
        if (this.socket) {
            try {
                await this.socket.logout();
            } catch (e) {
                // Already disconnected
            }
            this.socket = null;
            this.isConnected = false;
            this.isConnecting = false;
            console.log('[WhatsApp] Disconnected.');
        }
    }
}

// Export a singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;

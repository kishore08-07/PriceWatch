const dotenv = require('dotenv');
dotenv.config(); // Load environment variables FIRST

const express = require('express');
const cors = require('cors');
const connectDatabase = require('./config/database');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { startScheduler } = require('./jobs/scheduler');
const whatsappService = require('./services/whatsappService');

const app = express();

// Middleware
app.use(cors());
// Increase body size limit to 50 MB — review payloads with 500–1000 reviews
// easily exceed the default 100 KB limit, causing silent 413 errors.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Connect to MongoDB
connectDatabase();

// Routes
app.use('/api', routes);

// Error handling middleware
app.use(errorHandler);

// Start cron scheduler
startScheduler();

// Initialize WhatsApp service (auto-connects if session exists)
if (process.env.WHATSAPP_ENABLED !== 'false') {
    whatsappService.initialize().catch(err => {
        console.warn('[Server] WhatsApp auto-initialization failed:', err.message);
        console.warn('[Server] Use POST /api/whatsapp/initialize to connect manually.');
    });
}

// Start server
const PORT = 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


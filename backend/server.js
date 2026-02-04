const dotenv = require('dotenv');
dotenv.config(); // Load environment variables FIRST

const express = require('express');
const cors = require('cors');
const connectDatabase = require('./config/database');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { startScheduler } = require('./jobs/scheduler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDatabase();

// Routes
app.use('/api', routes);

// Error handling middleware
app.use(errorHandler);

// Start cron scheduler
startScheduler();

// Start server
const PORT = 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


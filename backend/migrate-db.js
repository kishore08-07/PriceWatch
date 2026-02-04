#!/usr/bin/env node

/**
 * Database Migration Script
 * Adds lastNotifiedPrice field to existing tracking documents
 * 
 * Usage: node migrate-db.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pricewatch';

async function migrate() {
    try {
        console.log('[Migration] Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('[Migration] ✅ Connected');

        const db = mongoose.connection.db;
        const trackingsCollection = db.collection('trackings');

        // Check how many documents need migration
        const needsMigration = await trackingsCollection.countDocuments({
            lastNotifiedPrice: { $exists: false }
        });

        console.log(`[Migration] Found ${needsMigration} documents needing migration`);

        if (needsMigration === 0) {
            console.log('[Migration] ✅ All documents already have lastNotifiedPrice field');
            await mongoose.disconnect();
            return;
        }

        // Add lastNotifiedPrice field to documents that don't have it
        const result = await trackingsCollection.updateMany(
            { lastNotifiedPrice: { $exists: false } },
            { $set: { lastNotifiedPrice: null } }
        );

        console.log(`[Migration] ✅ Updated ${result.modifiedCount} documents`);
        console.log('[Migration] Migration complete!');

        await mongoose.disconnect();
        console.log('[Migration] Disconnected from MongoDB');
        process.exit(0);

    } catch (error) {
        console.error('[Migration] ❌ Error:', error);
        process.exit(1);
    }
}

migrate();

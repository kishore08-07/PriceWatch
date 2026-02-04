const mongoose = require('mongoose');

const connectDatabase = async () => {
    if (!process.env.MONGODB_URI) {
        console.error("ERROR: MONGODB_URI not found in .env file");
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("Could not connect to MongoDB", err);
        process.exit(1);
    }
};

module.exports = connectDatabase;

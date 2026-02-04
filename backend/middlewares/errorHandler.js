const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // MongoDB duplicate key error
    if (err.code === 11000) {
        return res.status(409).json({
            success: false,
            message: "A price alert already exists for this product. Please refresh and try again."
        });
    }

    // Default error
    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorHandler;

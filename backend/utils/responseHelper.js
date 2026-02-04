const successResponse = (res, data, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        ...data,
        ...(message && { message })
    });
};

const errorResponse = (res, message, statusCode = 500, additionalData = {}) => {
    return res.status(statusCode).json({
        success: false,
        message,
        ...additionalData
    });
};

module.exports = { successResponse, errorResponse };

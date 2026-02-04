const { authenticateWithGoogle } = require('../services/authService');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const googleAuth = async (req, res) => {
    const { token } = req.body;
    
    try {
        const result = await authenticateWithGoogle(token);
        return successResponse(res, { user: result.user });
    } catch (error) {
        return errorResponse(res, error.message, 401);
    }
};

module.exports = { googleAuth };

const {
    createOrUpdateTracking,
    checkIfTrackingExists,
    getUserWatchlist,
    deactivateTracking,
    deleteTrackingByUrl,
    triggerManualPriceCheck,
    testEmailNotification
} = require('../services/trackingService');
const { validateTrackingInput } = require('../validators/trackingValidator');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const addTracking = async (req, res) => {
    const { userEmail, productName, currentPrice, targetPrice, url, platform, image, currency } = req.body;
    console.log("[Backend] Received tracking request:", { userEmail, productName, url, targetPrice });

    try {
        // Validate input
        const validation = validateTrackingInput(userEmail, url, targetPrice, currentPrice);
        if (!validation.isValid) {
            console.error("[Backend]", validation.error);
            return errorResponse(res, validation.error, 400);
        }

        const result = await createOrUpdateTracking({
            userEmail,
            productName,
            currentPrice: validation.parsedCurrentPrice,
            targetPrice: validation.parsedTargetPrice,
            url,
            platform,
            image,
            currency
        });

        const statusCode = result.message.includes('updated') ? 200 : 201;
        return successResponse(res, { tracking: result.tracking }, result.message, statusCode);

    } catch (error) {
        console.error("Tracking Error:", error);
        return errorResponse(res, "Error saving price alert. Please try again.", 500, { error: error.message });
    }
};

const checkTracking = async (req, res) => {
    try {
        const { email, url } = req.params;
        const decodedUrl = decodeURIComponent(url);

        const result = await checkIfTrackingExists(email, decodedUrl);
        res.json(result);
    } catch (error) {
        console.error("Check tracking error:", error);
        return errorResponse(res, "Error checking alert status");
    }
};

const listTracking = async (req, res) => {
    try {
        const list = await getUserWatchlist(req.params.email);
        res.json(list);
    } catch (error) {
        return errorResponse(res, "Error fetching watchlist");
    }
};

const deleteTracking = async (req, res) => {
    try {
        const result = await deactivateTracking(req.params.id);
        return successResponse(res, {}, result.message);
    } catch (error) {
        console.error("Delete alert error:", error);
        const statusCode = error.message === "Alert not found" ? 404 : 500;
        return errorResponse(res, error.message || "Error deleting alert", statusCode);
    }
};

const removeTracking = async (req, res) => {
    try {
        const { email, url } = req.params;
        const decodedUrl = decodeURIComponent(url);

        const result = await deleteTrackingByUrl(email, decodedUrl);
        return successResponse(res, {}, result.message);
    } catch (error) {
        console.error("Remove alert error:", error);
        const statusCode = error.message === "Alert not found" ? 404 : 500;
        return errorResponse(res, error.message || "Error removing alert", statusCode);
    }
};

const checkNow = async (req, res) => {
    try {
        const result = await triggerManualPriceCheck(req.params.id);
        return successResponse(res, result, "Price check completed");
    } catch (error) {
        console.error("Manual check error:", error);
        const statusCode = error.message === "Alert not found" ? 404 : 
                          error.message === "Alert is not active" ? 400 : 500;
        return errorResponse(res, error.message || "Error triggering price check", statusCode, { error: error.message });
    }
};

const testEmail = async (req, res) => {
    try {
        const result = await testEmailNotification(req.params.id);
        return successResponse(res, result, "Test email sent successfully");
    } catch (error) {
        console.error("Test email error:", error);
        const statusCode = error.message === "Alert not found" ? 404 : 500;
        return errorResponse(res, error.message || "Error sending test email", statusCode, { error: error.message });
    }
};

module.exports = {
    addTracking,
    checkTracking,
    listTracking,
    deleteTracking,
    removeTracking,
    checkNow,
    testEmail
};

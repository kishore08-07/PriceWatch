export const API_BASE_URL = 'http://localhost:8000';

export const API_ENDPOINTS = {
    AUTH: {
        GOOGLE: `${API_BASE_URL}/api/auth/google`,
        WHATSAPP_SEND_OTP: `${API_BASE_URL}/api/auth/whatsapp/send-otp`,
        WHATSAPP_VERIFY_OTP: `${API_BASE_URL}/api/auth/whatsapp/verify-otp`,
        WHATSAPP_TOGGLE: `${API_BASE_URL}/api/auth/whatsapp/toggle`,
        WHATSAPP_STATUS: (email) => `${API_BASE_URL}/api/auth/whatsapp/status/${email}`
    },
    WHATSAPP: {
        STATUS: `${API_BASE_URL}/api/whatsapp/status`,
        INITIALIZE: `${API_BASE_URL}/api/whatsapp/initialize`,
        QR: `${API_BASE_URL}/api/whatsapp/qr`
    },
    TRACKER: {
        ADD: `${API_BASE_URL}/api/tracker/add`,
        CHECK: (email, url) => `${API_BASE_URL}/api/tracker/check/${email}/${encodeURIComponent(url)}`,
        LIST: (email) => `${API_BASE_URL}/api/tracker/list/${email}`,
        DELETE: (id) => `${API_BASE_URL}/api/tracker/delete/${id}`,
        REMOVE: (email, url) => `${API_BASE_URL}/api/tracker/remove/${email}/${encodeURIComponent(url)}`,
        CHECK_NOW: (id) => `${API_BASE_URL}/api/tracker/check-now/${id}`,
        TEST_EMAIL: (id) => `${API_BASE_URL}/api/tracker/test-email/${id}`,
        TEST_WHATSAPP: (id) => `${API_BASE_URL}/api/tracker/test-whatsapp/${id}`
    },
    REVIEWS: {
        ANALYZE_DIRECT: `${API_BASE_URL}/api/reviews/analyze-direct`,
        INVALIDATE_CACHE: `${API_BASE_URL}/api/reviews/invalidate-cache`,
        HEALTH: `${API_BASE_URL}/api/reviews/health`
    },
    COMPARISON: {
        COMPARE: `${API_BASE_URL}/api/comparison/compare`
    }
};


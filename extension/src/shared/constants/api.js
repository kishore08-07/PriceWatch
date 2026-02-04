export const API_BASE_URL = 'http://localhost:8000';

export const API_ENDPOINTS = {
    AUTH: {
        GOOGLE: `${API_BASE_URL}/api/auth/google`
    },
    TRACKER: {
        ADD: `${API_BASE_URL}/api/tracker/add`,
        CHECK: (email, url) => `${API_BASE_URL}/api/tracker/check/${email}/${encodeURIComponent(url)}`,
        LIST: (email) => `${API_BASE_URL}/api/tracker/list/${email}`,
        DELETE: (id) => `${API_BASE_URL}/api/tracker/delete/${id}`,
        REMOVE: (email, url) => `${API_BASE_URL}/api/tracker/remove/${email}/${encodeURIComponent(url)}`,
        CHECK_NOW: (id) => `${API_BASE_URL}/api/tracker/check-now/${id}`,
        TEST_EMAIL: (id) => `${API_BASE_URL}/api/tracker/test-email/${id}`
    }
};

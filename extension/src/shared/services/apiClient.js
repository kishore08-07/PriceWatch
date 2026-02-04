import { API_ENDPOINTS } from '../constants/api';

const handleResponse = async (response) => {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Request failed');
    }
    return response.json();
};

const apiClient = {
    get: async (url) => {
        const response = await fetch(url);
        return handleResponse(response);
    },

    post: async (url, data) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return handleResponse(response);
    },

    delete: async (url) => {
        const response = await fetch(url, {
            method: 'DELETE'
        });
        return handleResponse(response);
    }
};

export default apiClient;

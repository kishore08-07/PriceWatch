import apiClient from './apiClient';
import { API_ENDPOINTS } from '../constants/api';

export const addTracking = async (trackingData) => {
    return await apiClient.post(API_ENDPOINTS.TRACKER.ADD, trackingData);
};

export const checkTracking = async (email, url) => {
    return await apiClient.get(API_ENDPOINTS.TRACKER.CHECK(email, url));
};

export const getWatchlist = async (email) => {
    return await apiClient.get(API_ENDPOINTS.TRACKER.LIST(email));
};

export const removeTracking = async (email, url) => {
    return await apiClient.delete(API_ENDPOINTS.TRACKER.REMOVE(email, url));
};

import apiClient from './apiClient';
import { API_ENDPOINTS } from '../constants/api';

export const authenticateWithGoogle = async (token) => {
    return await apiClient.post(API_ENDPOINTS.AUTH.GOOGLE, { token });
};

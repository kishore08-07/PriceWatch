import apiClient from './apiClient';
import { API_ENDPOINTS } from '../constants/api';

/**
 * Send OTP to the user's WhatsApp number.
 */
export const sendWhatsAppOtp = async (email, phoneNumber) => {
    return await apiClient.post(API_ENDPOINTS.AUTH.WHATSAPP_SEND_OTP, { email, phoneNumber });
};

/**
 * Verify the OTP entered by the user.
 */
export const verifyWhatsAppOtp = async (email, otp) => {
    return await apiClient.post(API_ENDPOINTS.AUTH.WHATSAPP_VERIFY_OTP, { email, otp });
};

/**
 * Toggle WhatsApp notifications on/off.
 */
export const toggleWhatsAppNotifications = async (email, enabled) => {
    return await apiClient.post(API_ENDPOINTS.AUTH.WHATSAPP_TOGGLE, { email, enabled });
};

/**
 * Get user's WhatsApp verification status.
 */
export const getWhatsAppStatus = async (email) => {
    return await apiClient.get(API_ENDPOINTS.AUTH.WHATSAPP_STATUS(email));
};

/**
 * Get backend WhatsApp service connection status.
 */
export const getWhatsAppServiceStatus = async () => {
    return await apiClient.get(API_ENDPOINTS.WHATSAPP.STATUS);
};

/**
 * Initialize backend WhatsApp connection and start QR generation.
 */
export const initializeWhatsAppService = async () => {
    return await apiClient.post(API_ENDPOINTS.WHATSAPP.INITIALIZE, {});
};

/**
 * Get currently active QR payload from backend.
 */
export const getWhatsAppQr = async () => {
    return await apiClient.get(API_ENDPOINTS.WHATSAPP.QR);
};

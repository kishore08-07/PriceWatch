import { useState, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import {
    sendWhatsAppOtp,
    verifyWhatsAppOtp,
    toggleWhatsAppNotifications,
    getWhatsAppStatus,
    getWhatsAppServiceStatus,
    initializeWhatsAppService,
    getWhatsAppQr
} from '../../shared/services/whatsappService';

export const useWhatsApp = (userEmail) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [otp, setOtp] = useState('');
    const [step, setStep] = useState('idle'); // idle | pair | phone | otp | verified
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const [whatsappStatus, setWhatsappStatus] = useState(null);
    const [serviceStatus, setServiceStatus] = useState(null);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState(null);

    const fetchServiceStatus = useCallback(async () => {
        try {
            const result = await getWhatsAppServiceStatus();
            if (result.success && result.whatsapp) {
                setServiceStatus(result.whatsapp);
                return result.whatsapp;
            }
            return null;
        } catch (_err) {
            return null;
        }
    }, []);

    const fetchQrCode = useCallback(async () => {
        try {
            const qrResult = await getWhatsAppQr();
            if (qrResult?.success && qrResult.qr) {
                const dataUrl = await QRCode.toDataURL(qrResult.qr, {
                    width: 220,
                    margin: 1
                });
                setQrCodeDataUrl(dataUrl);
                return true;
            }
            setQrCodeDataUrl(null);
            return false;
        } catch (_err) {
            setQrCodeDataUrl(null);
            return false;
        }
    }, []);

    const ensurePairingReady = useCallback(async () => {
        const status = await fetchServiceStatus();

        if (status?.connected) {
            setQrCodeDataUrl(null);
            return true;
        }

        await initializeWhatsAppService();
        await fetchServiceStatus();
        await fetchQrCode();
        return false;
    }, [fetchQrCode, fetchServiceStatus]);

    // Fetch WhatsApp status when user is available
    const fetchStatus = useCallback(async () => {
        if (!userEmail) return;

        try {
            const result = await getWhatsAppStatus(userEmail);
            if (result.success) {
                setWhatsappStatus(result);
                if (result.verified) {
                    setStep('verified');
                    setPhoneNumber(result.whatsappNumber || '');
                } else {
                    setStep('idle');
                }
            }
        } catch (err) {
            console.log('[WhatsApp] Could not fetch status:', err.message);
        }
    }, [userEmail]);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    useEffect(() => {
        if (step !== 'pair') return;

        const id = setInterval(async () => {
            const status = await fetchServiceStatus();
            if (status?.connected) {
                setStep('phone');
                setQrCodeDataUrl(null);
                setSuccessMessage('WhatsApp device connected. Enter your number to verify alerts.');
                return;
            }

            if (status?.hasQR || status?.connecting) {
                await fetchQrCode();
            }
        }, 4000);

        return () => clearInterval(id);
    }, [step, fetchServiceStatus, fetchQrCode]);

    const handleStartPairing = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const connected = await ensurePairingReady();
            if (connected) {
                setStep('phone');
                setSuccessMessage('WhatsApp device already connected. Enter your number to verify alerts.');
            } else {
                setStep('pair');
                setSuccessMessage('Scan the QR code with WhatsApp on your phone.');
            }
        } catch (err) {
            setError(err.message || 'Failed to initialize WhatsApp pairing.');
        } finally {
            setLoading(false);
        }
    }, [ensurePairingReady]);

    const handleRefreshPairing = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const status = await fetchServiceStatus();
            if (status?.connected) {
                setStep('phone');
                setQrCodeDataUrl(null);
                setSuccessMessage('WhatsApp device connected. Continue with OTP verification.');
                return;
            }

            const hasQr = await fetchQrCode();
            if (!hasQr) {
                await initializeWhatsAppService();
                await fetchQrCode();
            }
        } catch (err) {
            setError(err.message || 'Unable to refresh WhatsApp QR.');
        } finally {
            setLoading(false);
        }
    }, [fetchServiceStatus, fetchQrCode]);

    // Send OTP
    const handleSendOtp = useCallback(async () => {
        const status = await fetchServiceStatus();
        if (!status?.connected) {
            setStep('pair');
            setError('Connect WhatsApp first by scanning the QR code.');
            await handleRefreshPairing();
            return;
        }

        if (!phoneNumber.trim()) {
            setError('Please enter your WhatsApp number.');
            return;
        }

        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const result = await sendWhatsAppOtp(userEmail, phoneNumber.trim());
            if (result.success) {
                setStep('otp');
                setSuccessMessage(result.message);
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.message || 'Failed to send OTP.');
        } finally {
            setLoading(false);
        }
    }, [userEmail, phoneNumber, fetchServiceStatus, handleRefreshPairing]);

    // Verify OTP
    const handleVerifyOtp = useCallback(async () => {
        if (!otp.trim() || otp.length !== 6) {
            setError('Please enter a valid 6-digit OTP.');
            return;
        }

        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const result = await verifyWhatsAppOtp(userEmail, otp.trim());
            if (result.success) {
                setStep('verified');
                setSuccessMessage(result.message);
                setWhatsappStatus({ verified: true, notificationsEnabled: true, whatsappNumber: result.whatsappNumber });
                setOtp('');
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.message || 'Verification failed.');
        } finally {
            setLoading(false);
        }
    }, [userEmail, otp]);

    // Toggle notifications
    const handleToggle = useCallback(async (enabled) => {
        setLoading(true);
        setError(null);

        try {
            const result = await toggleWhatsAppNotifications(userEmail, enabled);
            if (result.success) {
                setWhatsappStatus(prev => ({ ...prev, notificationsEnabled: enabled }));
                setSuccessMessage(result.message);
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.message || 'Failed to update preferences.');
        } finally {
            setLoading(false);
        }
    }, [userEmail]);

    // Reset to re-verify
    const handleReset = useCallback(() => {
        setStep('pair');
        setOtp('');
        setError(null);
        setSuccessMessage(null);
    }, []);

    // Start verification flow
    const startVerification = useCallback(() => {
        handleStartPairing();
        setError(null);
        setSuccessMessage(null);
    }, [handleStartPairing]);

    return {
        phoneNumber,
        setPhoneNumber,
        otp,
        setOtp,
        step,
        loading,
        error,
        successMessage,
        whatsappStatus,
        serviceStatus,
        qrCodeDataUrl,
        handleStartPairing,
        handleRefreshPairing,
        handleSendOtp,
        handleVerifyOtp,
        handleToggle,
        handleReset,
        startVerification,
        fetchStatus
    };
};

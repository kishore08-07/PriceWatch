import React from 'react';
import Icons from '../../shared/components/Icons';

const WhatsAppSettings = ({
    step,
    phoneNumber,
    setPhoneNumber,
    otp,
    setOtp,
    loading,
    error,
    successMessage,
    whatsappStatus,
    serviceStatus,
    qrCodeDataUrl,
    onStartPairing,
    onRefreshPairing,
    onSendOtp,
    onVerifyOtp,
    onToggle,
    onReset,
    onStartVerification,
    onClose
}) => {
    return (
        <div className="whatsapp-settings glass animate-slide-up">
            <div className="whatsapp-header">
                <div className="whatsapp-title">
                    <span className="whatsapp-icon">📱</span>
                    <h3>WhatsApp Notifications</h3>
                </div>
                {onClose && (
                    <button className="btn-close" onClick={onClose} title="Close">✕</button>
                )}
            </div>

            {error && (
                <div className="whatsapp-error">
                    <Icons.AlertCircle size={14} />
                    <span>{error}</span>
                </div>
            )}

            {successMessage && (
                <div className="whatsapp-success">
                    <Icons.Check size={14} />
                    <span>{successMessage}</span>
                </div>
            )}

            {/* Step: Idle — not yet started */}
            {step === 'idle' && (
                <div className="whatsapp-idle">
                    <p className="whatsapp-description">
                        Get instant price drop alerts on WhatsApp! Verify your number to enable.
                    </p>
                    <button
                        className="btn btn-whatsapp w-full"
                        onClick={onStartPairing || onStartVerification}
                    >
                        <span>📱</span>
                        <span>Set Up WhatsApp Alerts</span>
                    </button>
                </div>
            )}

            {/* Step: Pair WhatsApp device via QR */}
            {step === 'pair' && (
                <div className="whatsapp-pair-step">
                    <p className="whatsapp-description">
                        1) Scan this QR in WhatsApp to connect PriceWatch service.<br />
                        2) Then verify your own number with OTP.
                    </p>

                    <div className="whatsapp-connection-chip">
                        <span className={`dot ${serviceStatus?.connected ? 'connected' : 'disconnected'}`}></span>
                        <span>{serviceStatus?.connected ? 'Service connected' : 'Service not connected'}</span>
                    </div>

                    {qrCodeDataUrl ? (
                        <div className="whatsapp-qr-wrapper">
                            <img src={qrCodeDataUrl} alt="WhatsApp pairing QR" className="whatsapp-qr-image" />
                        </div>
                    ) : (
                        <div className="whatsapp-qr-placeholder">Generating QR...</div>
                    )}

                    <div className="whatsapp-otp-actions">
                        <button
                            className="btn btn-whatsapp w-full"
                            onClick={onRefreshPairing}
                            disabled={loading}
                        >
                            {loading ? <span>Refreshing...</span> : <span>Refresh QR / Check Connection</span>}
                        </button>
                    </div>
                </div>
            )}

            {/* Step: Enter phone number */}
            {step === 'phone' && (
                <div className="whatsapp-phone-step">
                    <p className="whatsapp-description">
                        Enter your WhatsApp number with country code:
                    </p>
                    <div className="input-group">
                        <input
                            type="tel"
                            placeholder="+919876543210"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            className="whatsapp-input"
                            disabled={loading}
                            maxLength={15}
                        />
                    </div>
                    <p className="input-hint">Format: +[country code][number] (e.g., +919876543210)</p>
                    <p className="input-hint">QR connects the service. OTP verifies your personal number.</p>
                    <button
                        className="btn btn-whatsapp w-full"
                        onClick={onSendOtp}
                        disabled={loading || !phoneNumber.trim()}
                    >
                        {loading ? (
                            <span>Sending OTP...</span>
                        ) : (
                            <>
                                <span>📤</span>
                                <span>Send OTP</span>
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Step: Enter OTP */}
            {step === 'otp' && (
                <div className="whatsapp-otp-step">
                    <p className="whatsapp-description">
                        Enter the 6-digit OTP sent to <strong>{phoneNumber}</strong>:
                    </p>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Enter 6-digit OTP"
                            value={otp}
                            onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                setOtp(val);
                            }}
                            className="whatsapp-input otp-input"
                            disabled={loading}
                            maxLength={6}
                            autoFocus
                        />
                    </div>
                    <div className="whatsapp-otp-actions">
                        <button
                            className="btn btn-whatsapp w-full"
                            onClick={onVerifyOtp}
                            disabled={loading || otp.length !== 6}
                        >
                            {loading ? (
                                <span>Verifying...</span>
                            ) : (
                                <>
                                    <Icons.Check size={16} />
                                    <span>Verify OTP</span>
                                </>
                            )}
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={onSendOtp}
                            disabled={loading}
                        >
                            Resend OTP
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={onReset}
                            disabled={loading}
                        >
                            Change Number
                        </button>
                    </div>
                </div>
            )}

            {/* Step: Verified — show status and toggle */}
            {step === 'verified' && whatsappStatus && (
                <div className="whatsapp-verified-step">
                    <div className="whatsapp-verified-badge">
                        <span className="verified-icon">✅</span>
                        <div className="verified-info">
                            <span className="verified-label">WhatsApp Verified</span>
                            <span className="verified-number">{whatsappStatus.whatsappNumber || phoneNumber}</span>
                        </div>
                    </div>

                    <div className="whatsapp-toggle-row">
                        <span className="toggle-label">Price drop alerts</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={whatsappStatus.notificationsEnabled !== false}
                                onChange={(e) => onToggle(e.target.checked)}
                                disabled={loading}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    <button
                        className="btn btn-secondary btn-sm w-full"
                        onClick={onReset}
                        disabled={loading}
                    >
                        Change WhatsApp Number
                    </button>
                </div>
            )}
        </div>
    );
};

export default WhatsAppSettings;

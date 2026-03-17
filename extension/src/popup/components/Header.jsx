import React, { useEffect, useRef, useState } from 'react';
import Icons from '../../shared/components/Icons';

const Header = ({ user, onLogin, whatsappStatus }) => {
    const [showIdentityCard, setShowIdentityCard] = useState(false);
    const profileRef = useRef(null);

    useEffect(() => {
        const onDocClick = (event) => {
            if (!profileRef.current?.contains(event.target)) {
                setShowIdentityCard(false);
            }
        };

        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const isWhatsAppVerified = !!whatsappStatus?.verified;

    return (
        <header className="header">
            <div className="logo">
                <div className="logo-icon">
                    <Icons.Lightning />
                </div>
                <h1>PriceWatch</h1>
            </div>
            <div className="header-right">
                {user ? (
                    <div className="identity-menu" ref={profileRef}>
                        <button
                            className="user-profile"
                            title="Account verification details"
                            onClick={() => setShowIdentityCard(prev => !prev)}
                        >
                            <span className="profile-verification-icons">
                                <span className="profile-chip verified" title="Email verified">
                                    <Icons.Mail size={12} />
                                </span>
                                <span className={`profile-chip ${isWhatsAppVerified ? 'verified' : 'pending'}`} title={isWhatsAppVerified ? 'WhatsApp verified' : 'WhatsApp not verified'}>
                                    <Icons.MessageCircle size={12} />
                                </span>
                            </span>
                        </button>

                        {showIdentityCard && (
                            <div className="identity-card glass">
                                <div className="identity-card-row">
                                    <span className="identity-card-label">
                                        <Icons.Mail size={12} />
                                        Email Verified
                                    </span>
                                    <span className="identity-card-value">{user.email}</span>
                                </div>

                                <div className="identity-card-row">
                                    <span className="identity-card-label">
                                        <Icons.MessageCircle size={12} />
                                        WhatsApp {isWhatsAppVerified ? 'Verified' : 'Not Verified'}
                                    </span>
                                    <span className="identity-card-value">
                                        {isWhatsAppVerified
                                            ? (whatsappStatus?.whatsappNumber || 'Connected')
                                            : 'Not connected'}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <button className="btn btn-secondary btn-sm" onClick={onLogin}>
                        Sign In
                    </button>
                )}
                <div className="status-badge">
                    <span className="status-dot pulse"></span>
                    <span className="status-text">Active</span>
                </div>
            </div>
        </header>
    );
};

export default Header;

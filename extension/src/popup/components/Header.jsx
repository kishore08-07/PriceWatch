import React from 'react';
import Icons from '../../shared/components/Icons';

const Header = ({ user, onLogin }) => {
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
                    <div className="user-profile" title={user.email}>
                        <Icons.User />
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

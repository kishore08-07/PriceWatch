import React from 'react';
import Icons from '../../shared/components/Icons';

const ErrorState = ({ error, onRetry }) => {
    return (
        <div className="error-state animate-slide-up">
            <div className="error-icon">
                <Icons.AlertCircle />
            </div>
            <h4 className="error-title">Unable to Detect Product</h4>
            <p className="error-text">{error}</p>
            <button className="btn btn-secondary" onClick={onRetry}>
                <Icons.RefreshCw />
                <span>Retry Detection</span>
            </button>
        </div>
    );
};

export default ErrorState;

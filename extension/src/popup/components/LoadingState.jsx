import React from 'react';
import Icons from '../../shared/components/Icons';

const LoadingState = () => {
    return (
        <div className="loading-state">
            <Icons.Loader />
            <p className="loading-text">Analyzing product page...</p>
            <span className="loading-subtext">Supported: Amazon, Flipkart, Reliance Digital</span>
        </div>
    );
};

export default LoadingState;

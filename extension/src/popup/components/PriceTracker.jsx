import React from 'react';
import Icons from '../../shared/components/Icons';

const PriceTracker = ({
    product,
    targetPrice,
    validationError,
    isInputFocused,
    existingAlert,
    isTracking,
    onTargetPriceChange,
    onFocus,
    onBlur,
    onTrack
}) => {
    return (
        <div className="track-controls">
            <label className="input-label">
                <Icons.TrendingDown />
                <span>Target Price Alert</span>
            </label>

            {existingAlert && (
                <div className="existing-alert-info">
                    <span className="info-badge">
                        <Icons.Check />
                        Active alert: {product.currency}{existingAlert.targetPrice}
                    </span>
                    <span className="info-subtitle">Update to a new target price below</span>
                </div>
            )}

            {!existingAlert && product.available !== false && product.price && (
                <div className="input-helper">
                    <span className="helper-text">
                        Enter a price between {product.currency}1 and {product.currency}{product.price.toLocaleString()}
                    </span>
                </div>
            )}

            <div className={`input-group ${validationError ? 'error' : ''} ${isInputFocused ? 'focused' : ''} ${product.available === false || !product.price ? 'disabled' : ''}`}>
                <span className="currency-prefix">{product.currency}</span>
                <input
                    type="number"
                    placeholder={product.available === false || !product.price ? "Product unavailable" : (existingAlert ? "Enter new target price" : "Enter your target price")}
                    value={targetPrice}
                    onChange={onTargetPriceChange}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    min="1"
                    max={product.price}
                    step="1"
                    disabled={product.available === false || !product.price}
                />
            </div>

            {validationError && (
                <div className="validation-error">
                    <Icons.AlertCircle size={16} />
                    <span>{validationError}</span>
                </div>
            )}

            <button
                className={`btn btn-primary w-full ${isTracking ? 'btn-update' : ''}`}
                onClick={onTrack}
                disabled={product.available === false || !product.price || !targetPrice || !!validationError}
            >
                {isTracking ? (
                    <>
                        <Icons.Check />
                        <span>Update Price Alert</span>
                    </>
                ) : (
                    <>
                        <Icons.Bell />
                        <span>Enable Price Alert</span>
                    </>
                )}
            </button>
        </div>
    );
};

export default PriceTracker;

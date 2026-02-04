import React from 'react';
import Icons from '../../shared/components/Icons';

const WatchlistItem = ({ item, onRemove }) => {
    return (
        <div className="watchlist-item glass">
            <div className="watchlist-item-image">
                {item.image ? (
                    <img src={item.image} alt={item.productName} />
                ) : (
                    <div className="img-placeholder">
                        <Icons.Package />
                    </div>
                )}
            </div>
            <div className="watchlist-item-details">
                <h4 className="watchlist-item-name">{item.productName}</h4>
                <div className="watchlist-item-prices">
                    <div className="price-info">
                        <span className="price-info-label">Current</span>
                        <span className="price-info-value">{item.currency}{item.currentPrice}</span>
                    </div>
                    <div className="price-divider">→</div>
                    <div className="price-info target">
                        <span className="price-info-label">Target</span>
                        <span className="price-info-value">{item.currency}{item.targetPrice}</span>
                    </div>
                </div>
                <div className="watchlist-item-meta">
                    <span className="platform-tag">{item.platform}</span>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="view-product-link">
                        <Icons.ExternalLink />
                        <span>View</span>
                    </a>
                </div>
            </div>
            <button 
                className="remove-btn"
                onClick={onRemove}
                title="Remove from watchlist"
            >
                <Icons.Trash />
            </button>
        </div>
    );
};

export default WatchlistItem;

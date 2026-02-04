import React from 'react';
import WatchlistItem from './WatchlistItem';

const Watchlist = ({ trackedProducts, onRemoveItem }) => {
    return (
        <section className="watchlist-section">
            <h3 className="section-title">Active Watchlist</h3>
            {trackedProducts.length > 0 ? (
                <div className="watchlist-items">
                    {trackedProducts.map((item, index) => (
                        <WatchlistItem
                            key={index}
                            item={item}
                            onRemove={() => onRemoveItem(item, index)}
                        />
                    ))}
                </div>
            ) : (
                <div className="empty-watchlist">
                    <p className="empty-text">No products being tracked</p>
                    <span className="empty-subtext">Add products to receive price drop alerts</span>
                </div>
            )}
        </section>
    );
};

export default Watchlist;

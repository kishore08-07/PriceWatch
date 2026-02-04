import React from 'react';
import Icons from '../../shared/components/Icons';

const ProductCard = ({ product }) => {
    return (
        <div className="product-info">
            <div className="product-image">
                {product.image ? (
                    <img src={product.image} alt={product.name} />
                ) : (
                    <div className="img-placeholder">
                        <Icons.Package />
                    </div>
                )}
            </div>
            <div className="product-details">
                <h3 className="product-name">{product.name}</h3>
                <div className="price-container">
                    <span className="price-label">Current Price</span>
                    {product.available !== false && product.price ? (
                        <p className="price-tag">{product.currency}{product.price.toLocaleString()}</p>
                    ) : (
                        <p className="price-tag unavailable">Unavailable</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProductCard;

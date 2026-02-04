import React from 'react';
import Icons from '../../shared/components/Icons';

const FeatureGrid = () => {
    return (
        <section className="features-grid">
            <div className="feature-item glass">
                <div className="feature-icon">
                    <Icons.BarChart />
                </div>
                <div className="feature-content">
                    <span className="feature-title">Price Comparison</span>
                    <span className="feature-desc">Cross-platform analysis</span>
                </div>
            </div>
            <div className="feature-item glass">
                <div className="feature-icon">
                    <Icons.Sparkles />
                </div>
                <div className="feature-content">
                    <span className="feature-title">AI Insights</span>
                    <span className="feature-desc">Smart review summary</span>
                </div>
            </div>
        </section>
    );
};

export default FeatureGrid;

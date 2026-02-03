import React, { useState, useEffect } from 'react';
import './App.css';

// SVG Icons as components
const Icons = {
  Lightning: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  ),
  User: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Check: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Bell: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  TrendingDown: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  ),
  BarChart: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  Sparkles: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  RefreshCw: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  Package: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  Loader: () => (
    <svg className="spinner-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
};

function App() {
  const [product, setProduct] = useState(null);
  const [targetPrice, setTargetPrice] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  const fetchData = () => {
    setError(null);
    setProduct(null);

    const fetchTimeout = setTimeout(() => {
      if (!product) setError("Unable to detect product information. Please ensure you're on a product details page.");
    }, 5000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        setError("Please navigate to a supported e-commerce platform.");
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_PRODUCT_DETAILS' }, (response) => {
        if (chrome.runtime.lastError) {
          setError("Connection error. Please refresh the product page and try again.");
          return;
        }

        if (response && response.name && response.price) {
          setProduct(response);
          clearTimeout(fetchTimeout);
          chrome.storage.local.get(['trackedProducts'], (result) => {
            const tracked = result.trackedProducts || [];
            const isAlreadyTracked = tracked.some(p => p.name === response.name);
            setIsTracking(isAlreadyTracked);
          });
        } else {
          setError("Product information unavailable. Please refresh and ensure you're viewing a product page.");
        }
      });
    });
  };

  useEffect(() => {
    fetchData();

    chrome.storage.local.get(['userEmail'], (result) => {
      if (result.userEmail) {
        setUser({ email: result.userEmail });
      }
    });
  }, []);

  const handleLogin = (onSuccess = null) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error(chrome.runtime.lastError);
        return;
      }

      fetch('http://localhost:8000/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUser(data.user);
            chrome.storage.local.set({ userEmail: data.user.email });
            if (onSuccess && typeof onSuccess === 'function') onSuccess(data.user);
          }
        })
        .catch(err => console.error("Authentication error", err));
    });
  };

  const handleTrack = () => {
    if (!targetPrice) return;

    if (!user) {
      handleLogin((authenticatedUser) => {
        submitTracking(authenticatedUser.email);
      });
      return;
    }

    submitTracking(user.email);
  };

  const submitTracking = (email) => {
    const trackingData = {
      productName: product.name,
      currentPrice: product.price,
      url: product.url,
      platform: product.platform,
      image: product.image,
      currency: product.currency,
      targetPrice: parseInt(targetPrice),
      userEmail: email
    };

    chrome.storage.local.get(['trackedProducts'], (result) => {
      const tracked = result.trackedProducts || [];
      tracked.push(trackingData);
      chrome.storage.local.set({ trackedProducts: tracked }, () => {
        setIsTracking(true);
        fetch('http://localhost:8000/api/tracker/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trackingData)
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              console.log("Price tracking activated");
            }
          })
          .catch(err => console.error("Sync error", err));
      });
    });
  };

  return (
    <div className="app-container">
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
            <button className="btn btn-secondary btn-sm" onClick={handleLogin}>
              Sign In
            </button>
          )}
          <div className="status-badge">
            <span className="status-dot pulse"></span>
            <span className="status-text">Active</span>
          </div>
        </div>
      </header>

      <main className="content">
        {product ? (
          <div className="product-card glass animate-slide-up">
            <div className="platform-badge">{product.platform}</div>
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
                  <p className="price-tag">{product.currency}{product.price.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="track-controls">
              <label className="input-label">
                <Icons.TrendingDown />
                <span>Target Price Alert</span>
              </label>
              <div className="input-group">
                <span className="currency-prefix">{product.currency}</span>
                <input
                  type="number"
                  placeholder="Enter your target price"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                />
              </div>
              <button
                className={`btn btn-primary w-full ${isTracking ? 'active' : ''}`}
                onClick={handleTrack}
                disabled={!targetPrice}
              >
                {isTracking ? (
                  <>
                    <Icons.Check />
                    <span>Price Alert Active</span>
                  </>
                ) : (
                  <>
                    <Icons.Bell />
                    <span>Enable Price Alert</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="error-state animate-slide-up">
            <div className="error-icon">
              <Icons.AlertCircle />
            </div>
            <h4 className="error-title">Unable to Detect Product</h4>
            <p className="error-text">{error}</p>
            <button className="btn btn-secondary" onClick={fetchData}>
              <Icons.RefreshCw />
              <span>Retry Detection</span>
            </button>
          </div>
        ) : (
          <div className="loading-state">
            <Icons.Loader />
            <p className="loading-text">Analyzing product page...</p>
            <span className="loading-subtext">Supported: Amazon, Flipkart, Reliance Digital</span>
          </div>
        )}

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

        <section className="watchlist-section">
          <h3 className="section-title">Active Watchlist</h3>
          <div className="empty-watchlist">
            <p className="empty-text">No products being tracked</p>
            <span className="empty-subtext">Add products to receive price drop alerts</span>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p className="footer-text">PriceWatch Intelligence Platform</p>
      </footer>
    </div>
  );
}

export default App;

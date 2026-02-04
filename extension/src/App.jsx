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
  AlertCircle: ({ size = 48 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
  ),
  Trash: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  ExternalLink: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
};

function App() {
  const [product, setProduct] = useState(null);
  const [targetPrice, setTargetPrice] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [existingAlert, setExistingAlert] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [trackedProducts, setTrackedProducts] = useState([]);

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


        if (response && response.name) {
          setProduct(response);
          clearTimeout(fetchTimeout);

          // Check both local storage and backend for existing alerts
          chrome.storage.local.get(['userEmail', 'trackedProducts'], (result) => {
            const tracked = result.trackedProducts || [];
            const isAlreadyTracked = tracked.some(p => p.url === response.url);
            setIsTracking(isAlreadyTracked);

            // If user is logged in, also check backend for existing alert
            if (result.userEmail && response.url) {
              const encodedUrl = encodeURIComponent(response.url);
              fetch(`http://localhost:8000/api/tracker/check/${result.userEmail}/${encodedUrl}`)
                .then(res => res.json())
                .then(data => {
                  if (data.exists && data.tracking) {
                    setIsTracking(true);
                    setExistingAlert(data.tracking);
                    // Pre-fill target price if alert exists
                    setTargetPrice(data.tracking.targetPrice.toString());
                    console.log("Existing alert found:", data.tracking);
                  }
                })
                .catch(err => {
                  console.log("Could not check for existing alert:", err);
                  // Don't show error to user, just continue
                });
            }
          });
        } else {
          setError("Product information unavailable. Please refresh and ensure you're viewing a product page.");
        }
      });
    });
  };

  const fetchTrackedProducts = () => {
    chrome.storage.local.get(['userEmail', 'trackedProducts'], (result) => {
      if (result.userEmail) {
        setUser({ email: result.userEmail });
      }
      if (result.trackedProducts) {
        // Remove duplicates based on URL
        const uniqueProducts = [];
        const seenUrls = new Set();
        
        result.trackedProducts.forEach(product => {
          if (!seenUrls.has(product.url)) {
            seenUrls.add(product.url);
            uniqueProducts.push(product);
          }
        });
        
        // Update storage if duplicates were found
        if (uniqueProducts.length !== result.trackedProducts.length) {
          chrome.storage.local.set({ trackedProducts: uniqueProducts });
        }
        
        setTrackedProducts(uniqueProducts);
      }
    });
  };

  useEffect(() => {
    fetchData();
    fetchTrackedProducts();
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

  const validateTargetPrice = (value) => {
    if (!value || value.trim() === '') {
      setValidationError('');
      return false;
    }

    const parsedValue = parseFloat(value);

    if (isNaN(parsedValue)) {
      setValidationError('Please enter a valid number');
      return false;
    }

    if (parsedValue <= 0) {
      setValidationError('Price must be greater than ₹0');
      return false;
    }

    if (product && parsedValue > product.price) {
      setValidationError(`Must be ≤ current price (${product.currency}${product.price})`);
      return false;
    }

    setValidationError('');
    return true;
  };

  const handleTargetPriceChange = (e) => {
    const value = e.target.value;
    setTargetPrice(value);
    validateTargetPrice(value);
  };

  const handleTrack = () => {
    // Validate target price exists
    if (!targetPrice) {
      setError("Please enter a target price");
      setValidationError("Target price is required");
      return;
    }

    // Validate target price is a positive number
    const parsedTargetPrice = parseFloat(targetPrice);
    if (isNaN(parsedTargetPrice) || parsedTargetPrice <= 0) {
      setError("Target price must be a positive number");
      setValidationError("Price must be greater than ₹0");
      return;
    }

    // Validate target price is less than or equal to current price
    if (parsedTargetPrice > product.price) {
      setError(`Target price cannot be greater than current price (${product.currency}${product.price})`);
      setValidationError(`Must be ≤ ${product.currency}${product.price}`);
      return;
    }

    // Clear any previous errors
    setError(null);
    setValidationError('');


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
      targetPrice: parseFloat(targetPrice),
      userEmail: email
    };

    // First, send to backend for validation and duplicate checking
    fetch('http://localhost:8000/api/tracker/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trackingData)
    })
      .then(res => {
        if (!res.ok) {
          // Handle HTTP errors
          return res.json().then(errorData => {
            throw new Error(errorData.message || 'Failed to set price alert');
          });
        }
        return res.json();
      })
      .then(data => {
        if (data.success) {
          console.log("Price tracking activated:", data.message);

          // Update local storage only after successful backend save
          chrome.storage.local.get(['trackedProducts'], (result) => {
            const tracked = result.trackedProducts || [];

            // Check if product already exists in local storage
            const existingIndex = tracked.findIndex(p => p.url === product.url);

            if (existingIndex !== -1) {
              // Update existing entry
              tracked[existingIndex] = trackingData;
              console.log("Updated existing local tracking entry");
            } else {
              // Add new entry
              tracked.push(trackingData);
              console.log("Added new local tracking entry");
            }

            chrome.storage.local.set({ trackedProducts: tracked }, () => {
              setIsTracking(true);
              fetchTrackedProducts();
              // Clear target price input and show success (optional)
              // setTargetPrice('');
            });
          });
        } else {
          setError(data.message || 'Failed to set price alert');
        }
      })
      .catch(err => {
        console.error("Tracking error:", err);

        // Handle specific error types
        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
          setError("Network error. Please check your connection and ensure the backend server is running.");
        } else if (err.message.includes('401') || err.message.includes('authentication')) {
          setError("Session expired. Please sign in again.");
          setUser(null);
          chrome.storage.local.remove(['userEmail']);
        } else {
          setError(err.message || "Failed to set price alert. Please try again.");
        }
      });
  };

  const handleRemoveTracking = (item, index) => {
    // Remove from backend if user is logged in
    if (user?.email) {
      const encodedUrl = encodeURIComponent(item.url);
      fetch(`http://localhost:8000/api/tracker/remove/${user.email}/${encodedUrl}`, {
        method: 'DELETE'
      })
        .then(res => res.json())
        .then(data => {
          console.log('Removed from backend:', data);
        })
        .catch(err => {
          console.error('Failed to remove from backend:', err);
        });
    }

    // Remove from local storage
    const updated = trackedProducts.filter((_, i) => i !== index);
    chrome.storage.local.set({ trackedProducts: updated }, () => {
      setTrackedProducts(updated);
      if (product && item.url === product.url) {
        setIsTracking(false);
        setExistingAlert(null);
        setTargetPrice('');
      }
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
                  {product.available !== false && product.price ? (
                    <p className="price-tag">{product.currency}{product.price.toLocaleString()}</p>
                  ) : (
                    <p className="price-tag unavailable">Unavailable</p>
                  )}
                </div>
              </div>
            </div>

            <div className="track-controls">
              <label className="input-label">
                <Icons.TrendingDown />
                <span>Target Price Alert</span>
              </label>

              {/* Show existing alert info when updating */}
              {existingAlert && (
                <div className="existing-alert-info">
                  <span className="info-badge">
                    <Icons.Check />
                    Active alert: {product.currency}{existingAlert.targetPrice}
                  </span>
                  <span className="info-subtitle">Update to a new target price below</span>
                </div>
              )}

              {/* Helper text showing valid range */}
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
                  onChange={handleTargetPriceChange}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  min="1"
                  max={product.price}
                  step="1"
                  disabled={product.available === false || !product.price}
                />
              </div>

              {/* Real-time validation feedback */}
              {validationError && (
                <div className="validation-error">
                  <Icons.AlertCircle size={16} />
                  <span>{validationError}</span>
                </div>
              )}

              <button
                className={`btn btn-primary w-full ${isTracking ? 'btn-update' : ''}`}
                onClick={handleTrack}
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
          {trackedProducts.length > 0 ? (
            <div className="watchlist-items">
              {trackedProducts.map((item, index) => (
                <div key={index} className="watchlist-item glass">
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
                    onClick={() => handleRemoveTracking(item, index)}
                    title="Remove from watchlist"
                  >
                    <Icons.Trash />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-watchlist">
              <p className="empty-text">No products being tracked</p>
              <span className="empty-subtext">Add products to receive price drop alerts</span>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p className="footer-text">PriceWatch Intelligence Platform</p>
      </footer>
    </div>
  );
}

export default App;

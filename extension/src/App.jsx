import React, { useEffect } from 'react';
import './App.css';
import { useAuth } from './popup/hooks/useAuth';
import { useProduct } from './popup/hooks/useProduct';
import { useValidation } from './popup/hooks/useValidation';
import { useTracking } from './popup/hooks/useTracking';
import { storageService } from './shared/services/storageService';
import Header from './popup/components/Header';
import ProductCard from './popup/components/ProductCard';
import PriceTracker from './popup/components/PriceTracker';
import FeatureGrid from './popup/components/FeatureGrid';
import Watchlist from './popup/components/Watchlist';
import LoadingState from './popup/components/LoadingState';
import ErrorState from './popup/components/ErrorState';
import Footer from './popup/components/Footer';

function App() {
  const { user, setUser, login } = useAuth();
  const {
    product,
    error,
    setError,
    isTracking,
    setIsTracking,
    existingAlert,
    setExistingAlert,
    fetchProduct
  } = useProduct();
  const {
    targetPrice,
    setTargetPrice,
    validationError,
    isInputFocused,
    setIsInputFocused,
    handleTargetPriceChange,
    isValid
  } = useValidation(product?.price);
  const {
    trackedProducts,
    fetchTrackedProducts,
    submitTracking,
    handleRemoveTracking
  } = useTracking();

  useEffect(() => {
    const initializeApp = async () => {
      const userEmail = await storageService.getUserEmail();
      if (userEmail) {
        setUser({ email: userEmail });
      }
      await fetchTrackedProducts();
      await fetchProduct();
    };

    initializeApp();
  }, []);

  // Update target price when existing alert changes
  useEffect(() => {
    if (existingAlert) {
      setTargetPrice(existingAlert.targetPrice.toString());
    }
  }, [existingAlert]);

  const handleTrack = async () => {
    if (!targetPrice || !isValid()) {
      setError("Please enter a valid target price");
      return;
    }

    setError(null);

    if (!user) {
      login(async (authenticatedUser) => {
        await performTracking(authenticatedUser.email);
      });
      return;
    }

    await performTracking(user.email);
  };

  const performTracking = async (email) => {
    try {
      await submitTracking(product, targetPrice, email);
      setIsTracking(true);
    } catch (err) {
      console.error("Tracking error:", err);
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError("Network error. Please check your connection and ensure the backend server is running.");
      } else if (err.message.includes('401') || err.message.includes('authentication')) {
        setError("Session expired. Please sign in again.");
        setUser(null);
        await storageService.remove(['userEmail']);
      } else {
        setError(err.message || "Failed to set price alert. Please try again.");
      }
    }
  };

  const handleRemove = (item, index) => {
    handleRemoveTracking(
      item,
      index,
      user?.email,
      product?.url,
      setIsTracking,
      setExistingAlert,
      setTargetPrice
    );
  };

  return (
    <div className="app-container">
      <Header user={user} onLogin={login} />

      <main className="content">
        {product ? (
          <div className="product-card glass animate-slide-up">
            <div className="platform-badge">{product.platform}</div>
            <ProductCard product={product} />
            <PriceTracker
              product={product}
              targetPrice={targetPrice}
              validationError={validationError}
              isInputFocused={isInputFocused}
              existingAlert={existingAlert}
              isTracking={isTracking}
              onTargetPriceChange={handleTargetPriceChange}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onTrack={handleTrack}
            />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={fetchProduct} />
        ) : (
          <LoadingState />
        )}

        <FeatureGrid />
        <Watchlist
          trackedProducts={trackedProducts}
          onRemoveItem={handleRemove}
        />
      </main>

      <Footer />
    </div>
  );
}

export default App;

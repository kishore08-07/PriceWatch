import React, { useEffect, useState } from 'react';
import './App.css';
import { useAuth } from './popup/hooks/useAuth';
import { useProduct } from './popup/hooks/useProduct';
import { useValidation } from './popup/hooks/useValidation';
import { useTracking } from './popup/hooks/useTracking';
import { useWhatsApp } from './popup/hooks/useWhatsApp';
import { storageService } from './shared/services/storageService';
import Header from './popup/components/Header';
import ProductCard from './popup/components/ProductCard';
import PriceTracker from './popup/components/PriceTracker';
import FeatureGrid from './popup/components/FeatureGrid';
import Watchlist from './popup/components/Watchlist';
import LoadingState from './popup/components/LoadingState';
import ErrorState from './popup/components/ErrorState';
import Footer from './popup/components/Footer';
import WhatsAppSettings from './popup/components/WhatsAppSettings';

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

  const [showWhatsAppSettings, setShowWhatsAppSettings] = useState(false);

  const {
    phoneNumber,
    setPhoneNumber,
    otp,
    setOtp,
    step: whatsappStep,
    loading: whatsappLoading,
    error: whatsappError,
    successMessage: whatsappSuccess,
    whatsappStatus,
    serviceStatus,
    qrCodeDataUrl,
    handleStartPairing,
    handleRefreshPairing,
    handleSendOtp,
    handleVerifyOtp,
    handleToggle,
    handleReset,
    startVerification,
    fetchStatus: fetchWhatsAppStatus
  } = useWhatsApp(user?.email);

  const isWhatsAppVerified = whatsappStep === 'verified' || !!whatsappStatus?.verified;

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
    
    // Listen for storage changes to refresh watchlist when prices are updated
    const handleStorageChange = (changes, areaName) => {
      if (areaName === 'local' && changes.trackedProducts) {
        fetchTrackedProducts();
      }
    };
    
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Prevent popup from closing on tab switch
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Keep popup state alive
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          // Refresh product data when popup becomes visible again
          fetchProduct();
        }
      });
    };

    handleVisibilityChange();
  }, [fetchProduct]);

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
      <Header user={user} onLogin={login} whatsappStatus={whatsappStatus} />

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

        <FeatureGrid product={product} />
        
        {/* WhatsApp Settings Section */}
        {user && (
          <div className="whatsapp-section">
            {!showWhatsAppSettings && (
              <button
                className="btn btn-whatsapp-cta w-full"
                onClick={() => {
                  setShowWhatsAppSettings(true);
                  if (!isWhatsAppVerified) {
                    startVerification();
                  } else {
                    fetchWhatsAppStatus();
                  }
                }}
              >
                <span>📱</span>
                <span>{isWhatsAppVerified ? 'Manage WhatsApp Alerts' : 'Enable WhatsApp Alerts'}</span>
              </button>
            )}

            {showWhatsAppSettings && (
              <WhatsAppSettings
                step={whatsappStep}
                phoneNumber={phoneNumber}
                setPhoneNumber={setPhoneNumber}
                otp={otp}
                setOtp={setOtp}
                loading={whatsappLoading}
                error={whatsappError}
                successMessage={whatsappSuccess}
                whatsappStatus={whatsappStatus}
                serviceStatus={serviceStatus}
                qrCodeDataUrl={qrCodeDataUrl}
                onStartPairing={handleStartPairing}
                onRefreshPairing={handleRefreshPairing}
                onSendOtp={handleSendOtp}
                onVerifyOtp={handleVerifyOtp}
                onToggle={handleToggle}
                onReset={handleReset}
                onStartVerification={startVerification}
                onClose={() => setShowWhatsAppSettings(false)}
              />
            )}
          </div>
        )}

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

import { useState, useCallback } from 'react';
import { authenticateWithGoogle } from '../../shared/services/authService';
import { storageService } from '../../shared/services/storageService';

export const useAuth = () => {
    const [user, setUser] = useState(null);

    const login = useCallback((onSuccess) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.error(chrome.runtime.lastError);
                return;
            }

            authenticateWithGoogle(token)
                .then(data => {
                    if (data.success) {
                        setUser(data.user);
                        storageService.setUserEmail(data.user.email);
                        if (onSuccess && typeof onSuccess === 'function') {
                            onSuccess(data.user);
                        }
                    }
                })
                .catch(err => console.error("Authentication error", err));
        });
    }, []);

    return { user, setUser, login };
};

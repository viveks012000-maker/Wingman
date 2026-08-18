/**
 * =========================================================================================
 * MYWINGMAN SUPABASE AUTHENTICATION CLIENT & SESSION CONTROLLER
 * =========================================================================================
 * Full Supabase Auth Integration:
 * 1. Email/Password Signup (signUpUser)
 * 2. Email/Password Login (loginUser)
 * 3. Google OAuth Login (signInWithGoogle)
 * 4. Sign Out & Session Erasure (logoutUser)
 * 5. Active Session Persistence Listener (onAuthStateChange)
 * =========================================================================================
 */

(function () {
    'use strict';

    window.SUPABASE_URL = window.SUPABASE_URL || "https://gstnghuhhrxtwjdafufd.supabase.co";
    window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzdG5naHVoaHJ4dHdqZGFmdWZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4OTQ1NjksImV4cCI6MjEwMTQ3MDU2OX0.C-zQTjVBNjGsFJy8Yp1dhC11GWAkWD3s5ibbr0jdUuc";

    window.supabaseClient = null;
    window.currentSupabaseUser = null;
    window.currentSupabaseSession = null;

    window.__memoryStore = window.__memoryStore || {};

    function safeGet(key, defaultVal) {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                var v = localStorage.getItem(key);
                if (v !== null) return v;
            }
        } catch (e) {}
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                var vS = sessionStorage.getItem(key);
                if (vS !== null) return vS;
            }
        } catch (e) {}
        return (window.__memoryStore && window.__memoryStore[key] !== undefined) ? window.__memoryStore[key] : (defaultVal !== undefined ? defaultVal : null);
    }

    function safeSet(key, val) {
        var strVal = (val !== null && val !== undefined) ? String(val) : "";
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem(key, strVal);
            }
        } catch (e) {}
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                sessionStorage.setItem(key, strVal);
            }
        } catch (e) {}
        if (window.__memoryStore) window.__memoryStore[key] = strVal;
    }

    function safeRemove(key) {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.removeItem(key);
            }
        } catch (e) {}
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                sessionStorage.removeItem(key);
            }
        } catch (e) {}
        if (window.__memoryStore) delete window.__memoryStore[key];
    }

    // Helper toast display wrapper (falls back gracefully to alert if showToast not yet loaded)
    function notifyUser(msg, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type || 'info');
        } else {
            console.log('[' + (type || 'INFO').toUpperCase() + '] ' + msg);
        }
    }

    function isValidToken(t) {
        return t && typeof t === 'string' && t.trim().length > 10 && t !== 'undefined' && t !== 'null';
    }

    // Direct Supabase 'profiles' Table Credit Reader (Safe 406-Free Query)
    window.fetchProfileCredits = async function(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return null;
        try {
            const { data, error } = await client
                .from('profiles')
                .select('credits')
                .eq('id', userId)
                .maybeSingle();
            if (!error && data && typeof data.credits === 'number') {
                return data.credits;
            }
            if (!error && !data) {
                // Profile row missing in Supabase. Query trusted backend
                const apiBase = typeof window.getApiBase === 'function' ? window.getApiBase() : '';
                const headers = typeof window.getSupabaseAuthHeaders === 'function' ? await window.getSupabaseAuthHeaders() : {};
                const resp = await fetch((apiBase || '') + '/api/credits', { headers: headers });
                if (resp.status === 404) {
                    const errData = await resp.json().catch(() => ({}));
                    if (errData && (errData.error === 'PROFILE_MISSING' || errData.code === 'PROFILE_MISSING')) {
                        return { profileMissing: true };
                    }
                }
                if (resp.ok) {
                    const creditData = await resp.json();
                    if (creditData && typeof creditData.credits === 'number') {
                        return creditData.credits;
                    } else if (creditData && creditData.data && typeof creditData.data.credits_inr === 'number') {
                        return Math.round(creditData.data.credits_inr * 10);
                    }
                }
            }
        } catch (e) {
            console.warn('[SupabaseClient] Notice querying profiles credits:', e);
        }
        return null;
    };

    // Global Centralized Fresh Supabase Auth Header Provider
    window.getSupabaseAuthHeaders = async function () {
        const client = window.supabaseClient;
        if (!client) {
            if (window.currentSupabaseSession && window.currentSupabaseSession.access_token) {
                return { 'Authorization': 'Bearer ' + window.currentSupabaseSession.access_token };
            }
            return {};
        }
        try {
            const { data: { session } } = await client.auth.getSession();
            if (session && session.access_token) {
                return { 'Authorization': 'Bearer ' + session.access_token };
            }
        } catch (e) {
            console.warn('Failed to get session token:', e);
        }
        if (window.currentSupabaseSession && window.currentSupabaseSession.access_token) {
            return { 'Authorization': 'Bearer ' + window.currentSupabaseSession.access_token };
        }
        return {};
    };

    var initPromise = null;

    // Initialize Supabase Client (Singleton Promise Pattern)
    async function initSupabase() {
        if (window.supabaseClient) return window.supabaseClient;
        if (initPromise) return initPromise;

        initPromise = (async function () {
            var url = window.SUPABASE_URL;
            var key = window.SUPABASE_ANON_KEY;

            // Fetch from backend configuration API if available
            if (!url || !key) {
                try {
                    var apiBase;
                    if (typeof window.getApiBase === 'function') {
                        apiBase = window.getApiBase();
                    } else {
                        // Force localhost for file:// or null origin
                        if (window.location.origin === 'null' || window.location.protocol === 'file:') {
                            apiBase = 'http://localhost:3000';
                        } else {
                            apiBase = window.location.origin || 'http://localhost:3000';
                        }
                    }
                    var resp = await fetch(apiBase + '/api/config');
                    if (resp.ok) {
                        var data = await resp.json();
                        if (data.supabaseUrl && data.supabaseAnonKey) {
                            url = data.supabaseUrl;
                            key = data.supabaseAnonKey;
                        }
                    }
                } catch (e) {}
            }

            if (!url || !key) {
                console.warn('[SupabaseClient] Notice: SUPABASE_URL and SUPABASE_ANON_KEY are not configured on server.');
                return null;
            }

            if (window.supabase && typeof window.supabase.createClient === 'function') {
                try {
                    if (!window.supabaseClient) {
                        window.supabaseClient = window.supabase.createClient(url, key, {
                            auth: {
                                persistSession: true,
                                autoRefreshToken: true,
                                detectSessionInUrl: true
                            }
                        });
                        window.getSupabaseAuthHeaders = async function() {
                            const client = window.supabaseClient;
                            if (!client) {
                                if (window.currentSupabaseSession && window.currentSupabaseSession.access_token) {
                                    return { 'Authorization': 'Bearer ' + window.currentSupabaseSession.access_token };
                                }
                                return {};
                            }
                            try {
                                const { data: { session } } = await client.auth.getSession();
                                if (session && session.access_token) {
                                    return { 'Authorization': 'Bearer ' + session.access_token };
                                }
                            } catch (e) {
                                console.warn('Failed to get session token:', e);
                            }
                            if (window.currentSupabaseSession && window.currentSupabaseSession.access_token) {
                                return { 'Authorization': 'Bearer ' + window.currentSupabaseSession.access_token };
                            }
                            return {};
                        };
                    }

                // Attach Active Auth State Change Listener
                window.supabaseClient.auth.onAuthStateChange(function (event, session) {
                    window.currentSupabaseSession = session;
                    window.currentSupabaseUser = session ? session.user : null;

                    if (event === 'PASSWORD_RECOVERY') {
                        setPasswordRecoveryActive(true);
                        showPasswordRecoveryDialog();
                    }

                    if (session && session.user && session.access_token) {
                        safeSet('wingman_authenticated', 'true');
                        safeSet('wingman_login_agreed', 'true');
                        safeSet('wingman_user_authenticated', 'true');
                        safeSet('wingman_user_email', session.user.email || '');
                        updateAuthUIState(session.user);
                        if (typeof window.checkDashboardAuth === 'function') {
                            window.checkDashboardAuth();
                        }
                        if (typeof window.checkCreditBalance === 'function') {
                            window.checkCreditBalance();
                        }
                        if (typeof window.checkServerConsentStatus === 'function') {
                            window.checkServerConsentStatus();
                        }
                    } else if (event === 'SIGNED_OUT') {
                        safeRemove('wingman_authenticated');
                        safeRemove('wingman_user_authenticated');
                        safeRemove('wingman_user_email');
                        updateAuthUIState(null);
                    }
                });

                // Hydrate existing session or URL hash token on initial boot
                var sessionResp = await window.supabaseClient.auth.getSession();
                if (sessionResp && sessionResp.data && sessionResp.data.session) {
                    window.currentSupabaseSession = sessionResp.data.session;
                    window.currentSupabaseUser = sessionResp.data.session.user;
                    updateAuthUIState(window.currentSupabaseUser);
                    if (passwordRecoveryActive || hasPasswordRecoveryUrlMarker()) {
                        setPasswordRecoveryActive(true);
                        showPasswordRecoveryDialog();
                    }
                } else if (window.location.hash && window.location.hash.includes('access_token')) {
                    setTimeout(async function () {
                        var s = await window.supabaseClient.auth.getSession();
                        if (s && s.data && s.data.session) {
                            window.currentSupabaseSession = s.data.session;
                            window.currentSupabaseUser = s.data.session.user;
                            updateAuthUIState(s.data.session.user);
                        }
                    }, 200);
                }

            } catch (err) {
                console.error('Supabase Client initialization error:', err);
            }
            }
            return window.supabaseClient;
        })();

        return initPromise;
    }

    // Dynamic UI Update Helper for Authentication State
    function updateAuthUIState(user) {
        // ONLY trust real Supabase user objects — never self-authenticate from stale storage
        var isUserLoggedIn = !!(user || window.currentSupabaseUser);

        if (isUserLoggedIn) {
            safeSet('wingman_authenticated', 'true');
            safeSet('wingman_user_authenticated', 'true');

            // Only auto-redirect to app.html on OAuth callback (access_token in hash)
            if (window.location.hash && window.location.hash.includes('access_token') && !window.location.pathname.includes('app.html') && !window.location.pathname.includes('terms.html') && !window.location.pathname.includes('privacy.html') && !window.location.pathname.includes('refund.html')) {
                window.location.href = 'app.html' + (window.location.hash || '');
                return;
            }

            // Dismiss Auth Modal when active session exists
            if (typeof window.closeAuthRequiredModal === 'function') {
                window.closeAuthRequiredModal();
            }
        }

        // Clean up URL hash (#access_token=...) once session is established
        if (window.location.hash && window.location.hash.includes('access_token')) {
            try {
                window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
            } catch (e) {}
        }

        if (typeof window.loadUserCreditState === 'function') {
            window.loadUserCreditState(user || window.currentSupabaseUser);
        }
        if (typeof window.checkDashboardAuth === 'function') {
            window.checkDashboardAuth();
        }
        if (typeof window.updateTermsLockState === 'function') {
            window.updateTermsLockState();
        }
        if (typeof window.updateButtonStates === 'function') {
            window.updateButtonStates();
        }

        var topBanner = document.getElementById('topAuthBanner');
        if (topBanner) {
            if (isUserLoggedIn) {
                topBanner.classList.add('hidden');
            } else {
                topBanner.classList.remove('hidden');
            }
        }

        var userEmailBadge = document.getElementById('userEmailBadge');
        if (userEmailBadge) {
            if (user && user.email) {
                userEmailBadge.textContent = user.email;
                userEmailBadge.classList.remove('hidden');
            } else if (safeGet('wingman_user_email')) {
                userEmailBadge.textContent = safeGet('wingman_user_email');
                userEmailBadge.classList.remove('hidden');
            }
        }

        var signOutBtn = document.getElementById('headerSignOutBtn');
        if (signOutBtn) {
            if (isUserLoggedIn) {
                signOutBtn.classList.remove('hidden');
            } else {
                signOutBtn.classList.add('hidden');
            }
        }
    }

    var passwordRecoveryActive = safeGet('wingman_password_recovery_active') === 'true';
    var recoveryBodyOverflow = null;

    function authErrorCode(error) {
        return error && error.code ? String(error.code) : '';
    }

    function authErrorReasons(error) {
        return (error && Array.isArray(error.reasons)) ? error.reasons.map(function (reason) {
            return String(reason || '').toLowerCase();
        }) : [];
    }

    function formatAuthError(error, fallbackMessage) {
        var code = authErrorCode(error).toLowerCase();
        var name = error && error.name ? String(error.name).toLowerCase() : '';
        var reasons = authErrorReasons(error);
        var isWeakPassword = code === 'weak_password' || name.indexOf('weakpassword') !== -1 || name.indexOf('weak_password') !== -1;

        if (isWeakPassword) {
            if (reasons.indexOf('leaked_password') !== -1 || reasons.indexOf('pwned') !== -1) {
                return 'This password has appeared in known data breaches. Choose a different password that you do not reuse elsewhere.';
            }
            return 'This password does not meet the current security requirements. Choose a stronger password and try again.';
        }

        if (error && error.message) return String(error.message);
        return fallbackMessage || 'Authentication request failed.';
    }

    function hasPasswordRecoveryUrlMarker() {
        try {
            var search = window.location && window.location.search ? String(window.location.search) : '';
            if (typeof URLSearchParams !== 'undefined') {
                var params = new URLSearchParams(search);
                if (params.get('type') === 'recovery') return true;
            } else if (/(?:^|[?&])type=recovery(?:&|$)/.test(search)) {
                return true;
            }
            var hash = window.location && window.location.hash ? String(window.location.hash) : '';
            return /(?:^|[&#])type=recovery(?:&|$)/.test(hash);
        } catch (e) {
            return false;
        }
    }

    function setPasswordRecoveryActive(active) {
        passwordRecoveryActive = active === true;
        if (passwordRecoveryActive) safeSet('wingman_password_recovery_active', 'true');
        else safeRemove('wingman_password_recovery_active');
    }

    function cleanPasswordRecoveryUrl() {
        try {
            var pathname = (window.location && window.location.pathname) ? String(window.location.pathname) : '/app.html';
            var search = (window.location && window.location.search) ? String(window.location.search) : '';
            var cleanSearch = '';
            if (typeof URLSearchParams !== 'undefined') {
                var params = new URLSearchParams(search);
                params.delete('type');
                var encoded = params.toString();
                cleanSearch = encoded ? ('?' + encoded) : '';
            } else {
                cleanSearch = search.replace(/([?&])type=recovery(&|$)/, function (_, lead, tail) {
                    if (lead === '?' && tail === '&') return '?';
                    if (lead === '&' && tail === '&') return '&';
                    return '';
                }).replace(/[?&]$/, '');
            }
            if (window.history && typeof window.history.replaceState === 'function') {
                window.history.replaceState({}, document.title, pathname + cleanSearch);
            }
        } catch (e) {}
    }

    function removePasswordRecoveryDialog() {
        try {
            var overlay = document.getElementById('wingmanPasswordRecoveryOverlay');
            if (overlay && typeof overlay.remove === 'function') overlay.remove();
            else if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        } catch (e) {}
        try {
            if (document.body && document.body.style && recoveryBodyOverflow !== null) {
                document.body.style.overflow = recoveryBodyOverflow;
            }
        } catch (e) {}
        recoveryBodyOverflow = null;
    }

    function createRecoveryElement(tag, attributes, text) {
        var el = document.createElement(tag);
        Object.keys(attributes || {}).forEach(function (key) {
            if (key === 'style') el.style.cssText = attributes[key];
            else if (key === 'className') el.className = attributes[key];
            else if (key === 'type') el.type = attributes[key];
            else if (key === 'id') el.id = attributes[key];
            else if (key === 'disabled') el.disabled = attributes[key];
            else el.setAttribute(key, attributes[key]);
        });
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    function showPasswordRecoveryDialog() {
        if (!passwordRecoveryActive && !hasPasswordRecoveryUrlMarker()) return;
        if (!document || !document.body) {
            if (document && typeof document.addEventListener === 'function') {
                document.addEventListener('DOMContentLoaded', showPasswordRecoveryDialog, { once: true });
            }
            return;
        }
        if (document.getElementById('wingmanPasswordRecoveryOverlay')) return;

        setPasswordRecoveryActive(true);
        recoveryBodyOverflow = document.body.style ? (document.body.style.overflow || '') : '';
        if (document.body.style) document.body.style.overflow = 'hidden';

        var overlay = createRecoveryElement('div', {
            id: 'wingmanPasswordRecoveryOverlay',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'wingmanPasswordRecoveryTitle',
            'aria-describedby': 'wingmanPasswordRecoveryDescription',
            style: 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.92);backdrop-filter:blur(14px);font-family:Inter,system-ui,sans-serif;'
        });
        var panel = createRecoveryElement('div', {
            style: 'width:min(100%,430px);border:1px solid rgba(139,92,246,.55);border-radius:18px;padding:24px;background:#0b0b12;box-shadow:0 24px 80px rgba(0,0,0,.7);color:#fff;'
        });
        var title = createRecoveryElement('h2', { id: 'wingmanPasswordRecoveryTitle', style: 'margin:0 0 8px;font-size:22px;line-height:1.25;font-weight:800;' }, 'Choose a new password');
        var description = createRecoveryElement('p', { id: 'wingmanPasswordRecoveryDescription', style: 'margin:0 0 18px;color:#cbd5e1;font-size:14px;line-height:1.5;' }, 'Your recovery link is verified. Set a new password to finish securing your account.');
        var form = createRecoveryElement('form', { id: 'wingmanPasswordRecoveryForm', novalidate: 'novalidate' });
        var label1 = createRecoveryElement('label', { for: 'wingmanRecoveryNewPassword', style: 'display:block;margin:0 0 6px;color:#e2e8f0;font-size:13px;font-weight:700;' }, 'New password');
        var input1 = createRecoveryElement('input', {
            id: 'wingmanRecoveryNewPassword', type: 'password', autocomplete: 'new-password', minlength: '8', required: 'required',
            style: 'width:100%;box-sizing:border-box;margin:0 0 14px;padding:12px 14px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#050508;color:#fff;font-size:16px;outline:none;'
        });
        var label2 = createRecoveryElement('label', { for: 'wingmanRecoveryConfirmPassword', style: 'display:block;margin:0 0 6px;color:#e2e8f0;font-size:13px;font-weight:700;' }, 'Confirm new password');
        var input2 = createRecoveryElement('input', {
            id: 'wingmanRecoveryConfirmPassword', type: 'password', autocomplete: 'new-password', minlength: '8', required: 'required',
            style: 'width:100%;box-sizing:border-box;margin:0 0 14px;padding:12px 14px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#050508;color:#fff;font-size:16px;outline:none;'
        });
        var error = createRecoveryElement('div', { id: 'wingmanRecoveryError', role: 'alert', 'aria-live': 'assertive', style: 'display:none;margin:0 0 12px;padding:10px 12px;border:1px solid rgba(248,113,113,.4);border-radius:9px;background:rgba(127,29,29,.35);color:#fecaca;font-size:13px;line-height:1.4;' });
        var submit = createRecoveryElement('button', { id: 'wingmanRecoverySubmit', type: 'submit', style: 'width:100%;min-height:46px;border:0;border-radius:10px;background:#7c3aed;color:#fff;font-size:15px;font-weight:800;cursor:pointer;' }, 'Update password');

        form.appendChild(label1);
        form.appendChild(input1);
        form.appendChild(label2);
        form.appendChild(input2);
        form.appendChild(error);
        form.appendChild(submit);
        panel.appendChild(title);
        panel.appendChild(description);
        panel.appendChild(form);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        form.addEventListener('submit', async function (event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            error.style.display = 'none';
            error.textContent = '';
            submit.disabled = true;
            submit.textContent = 'Updating…';
            var result = await window.completePasswordRecovery(input1.value || '', input2.value || '');
            if (!result || !result.success) {
                error.textContent = (result && result.error) ? result.error : 'Unable to update password. Please try again.';
                error.style.display = 'block';
                submit.disabled = false;
                submit.textContent = 'Update password';
            }
        });

        try { input1.focus(); } catch (e) {}
    }

    window.completePasswordRecovery = async function (newPassword, confirmPassword) {
        var password = String(newPassword || '');
        var confirmation = String(confirmPassword || '');
        if (!passwordRecoveryActive && !hasPasswordRecoveryUrlMarker()) {
            return { success: false, error: 'No active password recovery request.' };
        }
        if (password.length < 8) {
            return { success: false, error: 'Password must be at least 8 characters long.' };
        }
        if (password !== confirmation) {
            return { success: false, error: 'Passwords do not match.' };
        }

        var client = await initSupabase();
        if (!client || !client.auth) {
            return { success: false, error: 'Authentication service is initializing. Please try again.' };
        }

        try {
            var sessionResp = await client.auth.getSession();
            var session = sessionResp && sessionResp.data ? sessionResp.data.session : null;
            if (!session || !session.user) {
                return { success: false, error: 'This recovery session is missing or expired. Request a new password reset link.' };
            }

            var resp = await client.auth.updateUser({ password: password });
            if (resp.error) {
                var message = formatAuthError(resp.error, 'Unable to update password.');
                return { success: false, error: message, code: authErrorCode(resp.error), reasons: authErrorReasons(resp.error) };
            }

            setPasswordRecoveryActive(false);
            cleanPasswordRecoveryUrl();
            removePasswordRecoveryDialog();
            notifyUser('Password updated successfully.', 'success');
            return { success: true, user: resp.data && resp.data.user ? resp.data.user : null };
        } catch (err) {
            return { success: false, error: formatAuthError(err, 'Unable to update password.'), code: authErrorCode(err), reasons: authErrorReasons(err) };
        }
    };

    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // 1. Email/Password Signup
    window.signUpUser = async function (email, password) {
        var cleanEmail = (email || "").trim().toLowerCase();
        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            var msg = 'Please enter a valid email address (e.g. name@domain.com).';
            notifyUser(msg, 'warning');
            return { success: false, error: msg };
        }
        if (!password || password.length < 8) {
            var msg = 'Password must be at least 8 characters long.';
            notifyUser(msg, 'warning');
            return { success: false, error: msg };
        }

        var client = await initSupabase();
        if (!client) {
            var msg = 'Authentication service is initializing. Please try again.';
            notifyUser(msg, 'warning');
            return { success: false, error: msg };
        }

        try {
            var resp = await client.auth.signUp({
                email: cleanEmail,
                password: password
            });

            if (resp.error) {
                var signupMessage = formatAuthError(resp.error, 'Sign up failed.');
                console.warn('Supabase Signup Error:', authErrorCode(resp.error) || resp.error.message);
                notifyUser(signupMessage, 'warning');
                return { success: false, error: signupMessage, code: authErrorCode(resp.error), reasons: authErrorReasons(resp.error) };
            }

            if (resp.data && resp.data.user) {
                if (resp.data.session && resp.data.session.access_token) {
                    safeSet('wingman_authenticated', 'true');
                    safeSet('wingman_login_agreed', 'true');
                    safeSet('wingman_user_authenticated', 'true');
                    safeSet('wingman_user_email', resp.data.user.email || cleanEmail);
                    updateAuthUIState(resp.data.user);
                    notifyUser('Account created! Welcome to MyWingman.', 'success');
                    return { success: true, user: resp.data.user, session: resp.data.session };
                } else {
                    notifyUser('Account created! Please check your email to confirm your account and sign in.', 'info');
                    return { success: true, user: resp.data.user, session: null, confirmationRequired: true };
                }
            }
            return { success: false, error: 'Sign up failed.' };
        } catch (err) {
            var errMsg = err ? (err.message || err.toString()) : 'Sign up error occurred.';
            console.error('Supabase Signup Error:', errMsg);
            notifyUser(errMsg, 'warning');
            return { success: false, error: errMsg };
        }
    };

    // 2. Email/Password Login
    window.loginUser = async function (email, password) {
        var cleanEmail = (email || "").trim().toLowerCase();
        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            var msg = 'Please enter a valid email address (e.g. name@domain.com).';
            notifyUser(msg, 'warning');
            return { success: false, error: msg };
        }
        if (!password || password.length < 8) {
            var msg = 'Password must be at least 8 characters long.';
            notifyUser(msg, 'warning');
            return { success: false, error: msg };
        }

        var client = await initSupabase();
        if (!client) {
            var msg = 'Authentication service is initializing. Please try again.';
            notifyUser(msg, 'warning');
            return { success: false, error: msg };
        }

        try {
            var resp = await client.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (resp.error) {
                var loginMessage = formatAuthError(resp.error, 'Login failed.');
                console.warn('Supabase Login Error:', authErrorCode(resp.error) || resp.error.message);
                notifyUser(loginMessage, 'warning');
                return { success: false, error: loginMessage, code: authErrorCode(resp.error), reasons: authErrorReasons(resp.error) };
            }

            if (resp.data && resp.data.user) {
                if (resp.data.session && resp.data.session.access_token) {
                    safeSet('wingman_authenticated', 'true');
                    safeSet('wingman_login_agreed', 'true');
                    safeSet('wingman_user_authenticated', 'true');
                    safeSet('wingman_user_email', resp.data.user.email || email);
                    updateAuthUIState(resp.data.user);
                    notifyUser('Signed in successfully!', 'success');
                    return { success: true, user: resp.data.user, session: resp.data.session };
                } else {
                    notifyUser('Please check your email to confirm your account before signing in.', 'warning');
                    return { success: false, error: 'Email confirmation required.', confirmationRequired: true };
                }
            }
            return { success: false, error: 'Login failed.' };
        } catch (err) {
            var errMsg = err ? (err.message || err.toString()) : 'Login error occurred.';
            console.error('Supabase Login Error:', errMsg);
            notifyUser(errMsg, 'warning');
            return { success: false, error: errMsg };
        }
    };

    // 3. Google OAuth Login (Launches Google Accounts Chooser)
    window.signInWithGoogle = async function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        try {
            var client = await initSupabase();

            if (client && client.auth) {
                var targetRedirect = (window.location.origin && window.location.origin !== 'null')
                    ? (window.location.origin + '/app.html')
                    : 'http://localhost:3000/app.html';

                var resp = await client.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: targetRedirect,
                        queryParams: {
                            prompt: 'select_account'
                        }
                    }
                });

                if (resp && resp.data && resp.data.url) {
                    window.location.href = resp.data.url;
                    return { success: true };
                } else if (resp && resp.error) {
                    notifyUser('Google Sign-In Error: ' + resp.error.message, 'warning');
                }
            }
        } catch (err) {
            console.error('Google OAuth Error:', err);
            notifyUser('OAuth Error: ' + (err ? err.message : err), 'warning');
        }
        return { success: false };
    };

    // 4. Password Reset via Email
    window.resetPasswordForEmail = async function (email) {
        var cleanEmail = (email || "").trim().toLowerCase();
        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            return { success: false, error: 'Please enter a valid email address (e.g. name@domain.com).' };
        }

        var client = await initSupabase();
        if (!client) {
            return { success: false, error: 'Authentication service is initializing. Please try again.' };
        }

        try {
            var redirectTo = (window.location.origin && window.location.origin !== 'null')
                ? (window.location.origin + '/app.html?type=recovery')
                : 'http://localhost:3000/app.html?type=recovery';

            var resp = await client.auth.resetPasswordForEmail(email, {
                redirectTo: redirectTo
            });

            if (resp.error) {
                console.warn('Password Reset Error:', resp.error.message);
                return { success: false, error: resp.error.message };
            }

            return { success: true };
        } catch (err) {
            var errMsg = err ? (err.message || err.toString()) : 'Password reset error occurred.';
            console.error('Password Reset Error:', errMsg);
            return { success: false, error: errMsg };
        }
    };

    // 5. Logout User & Clear Session
    window.logoutUser = function (e) {
        // Do NOT call e.preventDefault() — it can block navigation

        // 1. Wipe all storage
        try {
            window.currentSupabaseUser = null;
            window.currentSupabaseSession = null;
            window.__memoryStore = {};
            try { sessionStorage.clear(); } catch (e) {}
            try { localStorage.clear(); } catch (e) {}
        } catch (err) {}

        // 2. Background Supabase SignOut (fire-and-forget)
        try {
            if (window.supabaseClient && window.supabaseClient.auth) {
                window.supabaseClient.auth.signOut();
            }
        } catch (err) {}

        // 3. Navigate to landing page
        window.location.href = 'index.html';
    };
    window.forceSignOut = window.logoutUser;

    // Helper: Return Active Supabase User
    window.getCurrentUser = function () {
        return window.currentSupabaseUser || (safeGet('wingman_user_authenticated') === 'true' ? { email: safeGet('wingman_user_email') || 'User' } : null);
    };

    // Auto-run Supabase initialization on script load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSupabase);
    } else {
        initSupabase();
    }

    // Stage logging for debug diagnostics (Auth listener is already registered inside initSupabase)
    document.addEventListener('DOMContentLoaded', function () {
        console.log('1. DOM Loaded');
        console.log('2. Event Listeners Attached');
        console.log('3. Supabase Auth Checked');
    });

})();

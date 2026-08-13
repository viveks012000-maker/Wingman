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
                // Profile row missing in Supabase. Query trusted backend to safely auto-provision profile (0 initial credits)
                const apiBase = typeof window.getApiBase === 'function' ? window.getApiBase() : '';
                const headers = typeof window.getSupabaseAuthHeaders === 'function' ? await window.getSupabaseAuthHeaders() : {};
                const resp = await fetch((apiBase || '') + '/api/credits', { headers: headers });
                if (resp.ok) {
                    const creditData = await resp.json();
                    if (creditData && creditData.data && typeof creditData.data.credits_inr === 'number') {
                        return Math.round(creditData.data.credits_inr * 10);
                    } else if (creditData && typeof creditData.credits === 'number') {
                        return creditData.credits;
                    }
                }
            }
        } catch (e) {
            console.warn('[SupabaseClient] Notice querying profiles credits:', e);
        }
        return null;
    };

    // Global Centralized Fresh Supabase Auth Header Provider
    window.getSupabaseAuthHeaders = async function() {
        const client = window.supabaseClient;
        if (!client) {
            var fallbackToken = safeGet('wingman_jwt_token');
            return isValidToken(fallbackToken) ? { 'Authorization': 'Bearer ' + fallbackToken } : {};
        }
        try {
            const { data: { session } } = await client.auth.getSession();
            if (session && session.access_token) {
                safeSet('wingman_jwt_token', session.access_token);
                return { 'Authorization': 'Bearer ' + session.access_token };
            }
        } catch (e) {
            console.warn('Failed to get session token:', e);
        }
        var fallbackToken = safeGet('wingman_jwt_token');
        return isValidToken(fallbackToken) ? { 'Authorization': 'Bearer ' + fallbackToken } : {};
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
                            if (!client) return {};
                            try {
                                const { data: { session } } = await client.auth.getSession();
                                if (session && session.access_token) {
                                    safeSet('wingman_jwt_token', session.access_token);
                                    return { 'Authorization': 'Bearer ' + session.access_token };
                                }
                            } catch (e) {
                                console.warn('Failed to get session token:', e);
                            }
                            return {};
                        };
                    }

                // Attach Active Auth State Change Listener
                window.supabaseClient.auth.onAuthStateChange(function (event, session) {
                    window.currentSupabaseSession = session;
                    window.currentSupabaseUser = session ? session.user : null;

                    if (session && session.user) {
                        safeSet('wingman_authenticated', 'true');
                        safeSet('wingman_login_agreed', 'true');
                        safeSet('wingman_user_authenticated', 'true');
                        safeSet('wingman_user_email', session.user.email || '');
                        safeSet('wingman_terms_accepted', 'true');
                        if (session.access_token) {
                            safeSet('wingman_jwt_token', session.access_token);
                        }
                        updateAuthUIState(session.user);
                        if (typeof window.checkDashboardAuth === 'function') {
                            window.checkDashboardAuth();
                        }
                        if (typeof window.checkCreditBalance === 'function') {
                            window.checkCreditBalance();
                        }
                    } else if (event === 'SIGNED_OUT') {
                        safeRemove('wingman_authenticated');
                        safeRemove('wingman_user_authenticated');
                        safeRemove('wingman_user_email');
                        safeRemove('wingman_jwt_token');
                        updateAuthUIState(null);
                    }
                });

                // Hydrate existing session or URL hash token on initial boot
                var sessionResp = await window.supabaseClient.auth.getSession();
                if (sessionResp && sessionResp.data && sessionResp.data.session) {
                    window.currentSupabaseSession = sessionResp.data.session;
                    window.currentSupabaseUser = sessionResp.data.session.user;
                    updateAuthUIState(window.currentSupabaseUser);
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
            safeSet('wingman_login_agreed', 'true');
            safeSet('wingman_user_authenticated', 'true');
            safeSet('wingman_terms_accepted', 'true');
            if (typeof window.state === 'object' && window.state) {
                window.state.isTermsAccepted = true;
            }

            // Only auto-redirect to app.html on OAuth callback (access_token in hash)
            if (window.location.hash && window.location.hash.includes('access_token') && !window.location.pathname.includes('app.html') && !window.location.pathname.includes('terms.html') && !window.location.pathname.includes('privacy.html') && !window.location.pathname.includes('refund.html')) {
                window.location.href = 'app.html' + (window.location.hash || '');
                return;
            }

            // Automatically dismiss/hide Interstitial Age Gate & Auth Modals when active session exists
            if (typeof window.closeInterstitialModal === 'function') {
                window.closeInterstitialModal();
            }
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
                console.warn('Supabase Signup Error:', resp.error.message);
                notifyUser(resp.error.message, 'warning');
                return { success: false, error: resp.error.message };
            }

            if (resp.data && resp.data.user) {


                safeSet('wingman_authenticated', 'true');
                safeSet('wingman_login_agreed', 'true');
                safeSet('wingman_user_authenticated', 'true');
                safeSet('wingman_user_email', resp.data.user.email || cleanEmail);
                safeSet('wingman_terms_accepted', 'true');
                updateAuthUIState(resp.data.user);
                notifyUser('Account created! Welcome to MyWingman.', 'success');
                return { success: true, user: resp.data.user };
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
                console.warn('Supabase Login Error:', resp.error.message);
                notifyUser(resp.error.message, 'warning');
                return { success: false, error: resp.error.message };
            }

            if (resp.data && resp.data.user) {


                safeSet('wingman_authenticated', 'true');
                safeSet('wingman_login_agreed', 'true');
                safeSet('wingman_user_authenticated', 'true');
                safeSet('wingman_user_email', resp.data.user.email || email);
                safeSet('wingman_terms_accepted', 'true');
                updateAuthUIState(resp.data.user);
                notifyUser('Signed in successfully!', 'success');
                return { success: true, user: resp.data.user };
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

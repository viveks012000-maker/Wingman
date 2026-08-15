(function () {
    "use strict";

    // ============================================================
    // SAFE STORAGE WRAPPER – Browser Tracking Protection safe
    // ============================================================
    const safeStorage = {
        _memory: window.__memoryStore || {},
        get(key, defaultVal) {
            try {
                if (typeof localStorage !== 'undefined') {
                    const val = localStorage.getItem(key);
                    if (val !== null) return val;
                }
            } catch (_) { /* ignore */ }
            try {
                if (typeof sessionStorage !== 'undefined') {
                    const val = sessionStorage.getItem(key);
                    if (val !== null) return val;
                }
            } catch (_) { /* ignore */ }
            return this._memory[key] !== undefined ? this._memory[key] : (defaultVal !== undefined ? defaultVal : null);
        },
        set(key, val) {
            const strVal = (val !== null && val !== undefined) ? String(val) : "";
            try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, strVal); } catch (_) {}
            try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, strVal); } catch (_) {}
            this._memory[key] = strVal;
        },
        remove(key) {
            try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch (_) {}
            try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key); } catch (_) {}
            delete this._memory[key];
        },
        clear() {
            try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch (_) {}
            try { if (typeof sessionStorage !== 'undefined') sessionStorage.clear(); } catch (_) {}
            this._memory = {};
        }
    };
    window.__memoryStore = safeStorage._memory;
    // Legacy aliases for backward compatibility
    window.safeStorageGet = safeStorage.get.bind(safeStorage);
    window.safeStorageSet = safeStorage.set.bind(safeStorage);
    window.safeStorageRemove = safeStorage.remove.bind(safeStorage);
    window.safeStorageClear = safeStorage.clear.bind(safeStorage);

    // Dynamic Global API Endpoint Selector (Strict Environment Lock)
    function getApiBase() {
        if (typeof window !== 'undefined' && window.location) {
            const hostname = window.location.hostname || '';
            const protocol = window.location.protocol || '';
            const origin = window.location.origin || '';

            // 1. Strict Local Development Environment Lock
            const isLocalEnv = (
                protocol === 'file:' ||
                origin === 'null' ||
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('10.') ||
                hostname.endsWith('.local')
            );

            if (isLocalEnv) {
                return 'http://localhost:3000';
            }

            // 2. Production Environment Resolution (Cloudflare Pages / Hosted Domain)
            if (window.WINGMAN_CONFIG && window.WINGMAN_CONFIG.API_BASE_URL) {
                return String(window.WINGMAN_CONFIG.API_BASE_URL).replace(/\/+$/, '');
            }
            if (window.API_BASE_URL) return String(window.API_BASE_URL).replace(/\/+$/, '');
            if (window.RAILWAY_URL) return String(window.RAILWAY_URL).replace(/\/+$/, '');
            if (window.BACKEND_API_URL) return String(window.BACKEND_API_URL).replace(/\/+$/, '');

            // 3. Co-located Production Origin Fallback (No Localhost Fallback in Production)
            if (origin && origin !== 'null') {
                return origin.replace(/\/+$/, '');
            }
        }
        return '';
    }
    window.getApiBase = getApiBase;

    function countWords(str) {
        if (!str || typeof str !== 'string') return 0;
        const trimmed = str.trim();
        if (!trimmed) return 0;
        return trimmed.split(/\s+/).filter(Boolean).length;
    }
    window.countWords = countWords;

    // ============================================================
    // PRIVACY-SAFE FUNNEL ANALYTICS FOUNDATION
    // Never transmits screenshots, private chat texts, bios, or names.
    // Transmits only anonymized operational metadata.
    // ============================================================
    function trackWingmanEvent(eventName, metadata) {
        if (!eventName || typeof eventName !== 'string') return;
        try {
            const safeMeta = {};
            if (metadata && typeof metadata === 'object') {
                for (const [k, v] of Object.entries(metadata)) {
                    if (typeof v === 'string' && (v.length > 80 || v.startsWith('data:') || k.toLowerCase().includes('text') || k.toLowerCase().includes('bio') || k.toLowerCase().includes('prompt') || k.toLowerCase().includes('message'))) {
                        continue;
                    }
                    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 80)) {
                        safeMeta[k] = v;
                    }
                }
            }
            safeMeta.timestamp = new Date().toISOString();
            
            if (typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('wingman_analytics', { detail: { event: eventName, meta: safeMeta } }));
            }
            if (Array.isArray(window.dataLayer)) {
                window.dataLayer.push({ event: eventName, ...safeMeta });
            }
            
            const token = window.currentSupabaseUser ? (window.currentSupabaseSession && window.currentSupabaseSession.access_token) : null;
            fetch((window.getApiBase ? window.getApiBase() : '') + '/api/analytics/event', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': 'Bearer ' + token } : {})
                },
                body: JSON.stringify({ event: eventName, meta: safeMeta })
            }).catch(() => {});
        } catch (_) {}
    }
    window.trackWingmanEvent = trackWingmanEvent;

    // ============================================================
    // GLOBAL STATE & LIFECYCLE
    // ============================================================
    const STORAGE_KEY = "wingman_credits";
    const SESSION_KEY = "wingman_session_data";
    const CREDITS_PER_INR = 10;

    let activeCropperInstance = null;
    let currentUploadedRawDataUrl = null;
    let tickerInterval = null;
    const telemetryIntervals = {};
    let activeSimulatorThread = [];

    const state = {
        credits: null,
        creditsStatus: "idle",
        activeTab: "analyzeSection",
        activeTone: "Witty",
        selectedTone: "Witty",
        selectedVibe: "Direct",
        selectedBioStyle: "Punchy",
        uploadedFiles: [],
        rawImageFile: null,
        croppedWebpDataUrl: null,
        isLoading: false,
        isTermsAccepted: false,
        lifecycle: "EMPTY",
        selectedTier: { value: "elite", credits: 3000, price: 19.99 },
        activeTranscriptCache: null,
        activeSimulatorVibe: "analysis",
        showPlexus: safeStorage.get("wingman_setting_plexus", "true") !== "false",
        shorthandOption: safeStorage.get("wingman_setting_shorthand", "true") !== "false",
        emojiOption: parseInt(safeStorage.get("wingman_setting_emoji", "1") || "1")
    };
    window.state = state;

    // Tone mapping
    const TONE_HUD_MAP = {
        Witty: { val: 93, score: "93%", strategy: "The Playful Pivot", card1: "93%", card2: "86%", card3: "78%" },
        Flirty: { val: 87, score: "87%", strategy: "The Direct Hook", card1: "87%", card2: "80%", card3: "72%" },
        Casual: { val: 76, score: "76%", strategy: "The Low-Key Pivot", card1: "76%", card2: "69%", card3: "61%" },
        Bold: { val: 84, score: "84%", strategy: "The High-Intent Push", card1: "84%", card2: "77%", card3: "69%" },
        closer: { val: 96, score: "96%", strategy: "Transition Complete", card1: "96%", card2: "91%", card3: "85%" }
    };

    const TICKER_MESSAGES = [
        "OCR_THREAD_ACTIVE // DECODING_CONTEXT // STRATEGY_LOCK",
        "MAPPING_CONVERSATION_DYNAMICS",
        "EXTRACTING_KEY_ATTRACTION_SIGNALS",
        "SYNTHESIZING_INTENT_STRATEGY",
        "COMPUTING_MATCH_VELOCITY"
    ];

    const ANALYZE_MESSAGES = [
        "ESTABLISHING CONTEXT ENVELOPE...",
        "SEGMENTING DIALOGUE BALLOONS...",
        "RUNNING RECURSIVE TRANSLATION CORE...",
        "CALIBRATING TONE COEFFICIENTS...",
        "DECODING INTERPERSONAL ATTRACTION VELOCITY...",
        "EXTRACTING ATTENTIONAL PEAK VALUES...",
        "COMPUTING HIGH-STATUS ESCAPE PATHS...",
        "SYNTHESIZING CONTEXTUAL BANTER..."
    ];

    const ICEBREAK_MESSAGES = [
        "COMPILING MATCH PROFILE SCHEMA...",
        "FILTERING CLICHES & TRITE PHRASES...",
        "DETECTING SHARED VALUE HOOKS...",
        "PARSING PERSONAL INTEREST MATRIX...",
        "CALIBRATING ATTRACTION SIGNAL DENSITY...",
        "DETERMINING OPTIMAL VIBE RESPONSE VECTOR...",
        "SYNTHESIZING VERBAL OPENERS..."
    ];

    const OPTIMIZE_MESSAGES = [
        "INITIALIZING AUDIT ENGINE...",
        "DETECTING CONVERSATIONAL LEVERAGE POINTS...",
        "WEIGHING PASSIVE & ACTIVE CONVERSION RATES...",
        "CALIBRATING CHARISMA COEFFICIENTS...",
        "IDENTIFYING HIGH-STATUS PIVOT VECTORS...",
        "SYNTHESIZING PREMIUM BIO VARIATIONS..."
    ];

    const practicePartnerSystemContext = `You are Maeve—an intelligent 22-year-old dating conversation practice partner. You roleplay realistic match responses so the user can practice texting, flirting, date setups, and conversation recovery.

STRICT LAWS:
1. HARD LENGTH LIMIT: Maximum 5 to 8 words per reply. Write EXACTLY 1 short, natural line.
2. STRICT TEXT-ONLY MEDIA BOUNDARY: You cannot read or view images, screenshots, audio, or videos. Never ask for screenshots, photos, audio, or video clips. Instruct the user to type out or paste their text.
3. CONVERSATION PRACTICE FOCUS: Keep the roleplay realistic, engaging, and friendly.
4. CASING: 100% strictly lowercase text. Max 1 natural emoji at the end (😏, 🙈, 😉, 🥹, 💅).`;

    // ============================================================
    // DOM HELPERS
    // ============================================================
    function $(id) {
        if (id === 'privacyConsent') {
            return document.getElementById('privacyConsent') || document.getElementById('interstitialCheckbox');
        }
        if (id === 'interstitialCheckbox') {
            return document.getElementById('interstitialCheckbox') || document.getElementById('privacyConsent');
        }
        return document.getElementById(id);
    }

    function esc(str) {
        if (!str) return "";
        const d = document.createElement("div");
        d.appendChild(document.createTextNode(String(str)));
        return d.innerHTML;
    }

    function cleanSystemTags(str) {
        if (!str) return "";
        let clean = str;
        clean = clean.replace(/\[MOMENTUM_STATUS\]/gi, "");
        clean = clean.replace(/\[GHOST_RISK\]/gi, "");
        clean = clean.replace(/\[(?:REPLY_OPTION|BIO_OPTION|ICEBREAKER_OPTION|PSYCHOLOGY|TAG_NAME)_\d+\]/gi, "");
        clean = clean.replace(/\[[^\]]*\]/g, "");
        clean = clean.replace(/^\(|\)$/g, "");
        clean = clean.replace(/^[✅👉\s\*\-]*chronological thread lock.*$/gim, "");
        clean = clean.replace(/^[✅👉\s\*\-]*last message sent by.*$/gim, "");
        clean = clean.replace(/^--- SCREENSHOT.*$/gim, "");
        return clean.trim();
    }

    // ============================================================
    // USER KEY GENERATION (guest / authenticated)
    // ============================================================
    window.getUserKey = function(baseKey, userId) {
        if (!userId) {
            try {
                const session = window.currentSupabaseSession || (window.supabaseClient ? window.supabaseClient.auth.session : null);
                const currentUser = window.currentSupabaseUser || ((window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.user === 'function') ? window.supabaseClient.auth.user() : null);
                userId = (currentUser && currentUser.id) ? currentUser.id : (session && session.user ? session.user.id : (currentUser && currentUser.email ? currentUser.email : null));
            } catch(e){}
        }
        return userId ? (baseKey + "_" + String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")) : (baseKey + "_guest");
    };
    window.getPerUserKey = window.getUserKey;
    window.getUserStorageKey = window.getUserKey;

    // ============================================================
    // CREDIT MANAGEMENT – Server‑authoritative
    // ============================================================
    function loadInitialCredits() {
        return 0;
    }

    function saveCredits(val) {
        try {
            if (typeof val === 'number') {
                const key = window.getUserKey("wingman_credits");
                safeStorage.set(key, val);
            }
        } catch (e) {}
    }

    window.loadUserCreditState = function(user) {
        try {
            if (user && user.id) {
                window.checkCreditBalance();
            }
        } catch (e) {}
    };

    function syncCredits() {
        if (typeof state.credits === 'number') {
            saveCredits(state.credits);
            const label = state.credits + " Credit" + (state.credits === 1 ? "" : "s");
            const desk = $("desktopCreditCount");
            if (desk) desk.textContent = label;
            const mob = $("mobileCreditCount");
            if (mob) mob.textContent = label;
            const hud = $("hudScoreBadge");
            if (hud) hud.textContent = state.credits + " Credits";
        }
    }

    window.updateUICredits = function (amount) {
        if (typeof amount === 'number') {
            state.credits = amount;
            state.creditsStatus = "loaded";
            syncCredits();
        } else if (amount === null) {
            state.credits = null;
            state.creditsStatus = "loading";
        }
    };

    // Supabase Postgres Direct Profile Credit Sync – Reads 'profiles' table directly
    window.checkCreditBalance = async function () {
        state.creditsStatus = "loading";
        try {
            // Authoritative session retrieval via Supabase auth.getSession()
            let session = null;
            if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.getSession === 'function') {
                try {
                    const { data, error } = await window.supabaseClient.auth.getSession();
                    if (!error && data && data.session) {
                        session = data.session;
                        window.currentSupabaseSession = session;
                        window.currentSupabaseUser = session.user;
                    }
                } catch (sessErr) {
                    console.warn('[CreditSync] Notice querying Supabase session:', sessErr);
                }
            }
            if (!session) {
                session = window.currentSupabaseSession;
            }

            const user = session ? session.user : window.currentSupabaseUser;
            const userId = user ? (user.id || user.email) : null;
            if (!userId) {
                // Session is still restoring or user is not logged in.
                // DO NOT set credits to 0!
                state.creditsStatus = "idle";
                return { success: false, status: "unauthenticated", credits: state.credits };
            }

            // 1. Direct Supabase 'profiles' table query
            if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
                try {
                    const { data, error } = await window.supabaseClient
                        .from('profiles')
                        .select('credits')
                        .eq('id', user.id || userId)
                        .maybeSingle();

                    if (!error && data && typeof data.credits === 'number') {
                        window.updateUICredits(data.credits);
                        return { success: true, status: "loaded", credits: data.credits };
                    }
                    if (!error && !data) {
                        // Profile row missing in Supabase
                        state.credits = null;
                        state.creditsStatus = "missing_profile";
                        return { success: false, status: "missing_profile", code: "PROFILE_MISSING" };
                    }
                } catch (dbErr) {
                    console.warn('[CreditSync] Supabase direct profiles query notice:', dbErr);
                }
            }

            // 2. Fetch via fetchProfileCredits
            if (typeof window.fetchProfileCredits === 'function') {
                try {
                    const creditsRes = await window.fetchProfileCredits(user.id || userId);
                    if (typeof creditsRes === 'number') {
                        window.updateUICredits(creditsRes);
                        return { success: true, status: "loaded", credits: creditsRes };
                    } else if (creditsRes && creditsRes.profileMissing) {
                        state.credits = null;
                        state.creditsStatus = "missing_profile";
                        return { success: false, status: "missing_profile", code: "PROFILE_MISSING" };
                    }
                } catch (fErr) {
                    console.warn('[CreditSync] fetchProfileCredits notice:', fErr);
                }
            }

            // 3. Fallback: Authenticated query to /api/credits
            const apiBase = typeof window.getApiBase === 'function' ? window.getApiBase() : '';
            const authHeaders = typeof window.getSupabaseAuthHeaders === 'function' ? await window.getSupabaseAuthHeaders() : {};
            if (authHeaders && authHeaders.Authorization) {
                const resp = await fetch((apiBase || '') + '/api/credits', { headers: authHeaders });
                if (resp.status === 404) {
                    const errData = await resp.json().catch(() => ({}));
                    if (errData && (errData.error === 'PROFILE_MISSING' || errData.code === 'PROFILE_MISSING')) {
                        state.credits = null;
                        state.creditsStatus = "missing_profile";
                        return { success: false, status: "missing_profile", code: "PROFILE_MISSING" };
                    }
                }
                if (resp.ok) {
                    const resJson = await resp.json();
                    if (resJson && typeof resJson.credits === 'number') {
                        window.updateUICredits(resJson.credits);
                        return { success: true, status: "loaded", credits: resJson.credits };
                    } else if (resJson && resJson.data && typeof resJson.data.credits_inr === 'number') {
                        const count = Math.round(resJson.data.credits_inr * 10);
                        window.updateUICredits(count);
                        return { success: true, status: "loaded", credits: count };
                    }
                }
            }

            // If balance cannot be verified, record error state without setting credits to 0
            state.creditsStatus = "error";
            return { success: false, status: "error", credits: state.credits };
        } catch (e) {
            console.warn('[CreditSync] Error syncing credits from Supabase profiles:', e);
            state.creditsStatus = "error";
            return { success: false, status: "error", credits: state.credits, error: e };
        }
    };
    window.fetchAndSyncUserCredits = window.checkCreditBalance;

    // DEPRECATED: no local deduction; kept as no‑op for backward compatibility
    window.deductUserCreditBalance = async function (cost) {
        try {
            await window.checkCreditBalance();
        } catch (e) {
            console.warn("Credit sync failed", e);
        }
    };

    // Authoritative Authentication Check using real Supabase session
    async function isUserAuthenticated() {
        if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.getSession === 'function') {
            try {
                const { data, error } = await window.supabaseClient.auth.getSession();
                if (!error && data && data.session && data.session.user && data.session.access_token) {
                    window.currentSupabaseSession = data.session;
                    window.currentSupabaseUser = data.session.user;
                    return true;
                }
            } catch (e) {}
        }
        if (window.currentSupabaseSession && window.currentSupabaseSession.access_token && window.currentSupabaseUser) {
            return true;
        }
        return false;
    }
    window.isUserAuthenticated = isUserAuthenticated;

    async function hasSufficientCredits(cost) {
        cost = cost || 10;
        const isAuth = await isUserAuthenticated();
        if (!isAuth) {
            if (typeof window.showToast === 'function') {
                window.showToast("Authentication required to use AI features. Please sign in.", "warning");
            }
            if (typeof window.openAuthRequiredModal === 'function') {
                window.openAuthRequiredModal();
            }
            return false;
        }

        // If credits unknown or loading, fetch now
        if (state.credits === null || state.creditsStatus === 'loading' || state.creditsStatus === 'idle') {
            await window.checkCreditBalance();
        }

        // If profile is missing
        if (state.creditsStatus === "missing_profile") {
            if (typeof window.showToast === 'function') {
                window.showToast("Your account profile could not be loaded. Please contact support or try again later.", "warning");
            }
            return false;
        }

        // If credits still unknown or in error state after check
        if (state.credits === null || state.creditsStatus === 'error') {
            const syncResult = await window.checkCreditBalance();
            if (syncResult && syncResult.status === "missing_profile") {
                if (typeof window.showToast === 'function') {
                    window.showToast("Your account profile could not be loaded. Please contact support or try again later.", "warning");
                }
                return false;
            }
            if (!syncResult || !syncResult.success || typeof state.credits !== 'number') {
                if (typeof window.showToast === 'function') {
                    window.showToast("Unable to verify credit balance. Please check your connection and try again.", "warning");
                }
                return false;
            }
        }

        // Never trust a previously cached low numeric balance as sufficient evidence to sell credits.
        // A fresh authoritative balance check is mandatory immediately before opening the purchase UI.
        if (state.credits < cost) {
            const freshCreditCheck = await window.checkCreditBalance();
            if (!freshCreditCheck || !freshCreditCheck.success || typeof state.credits !== 'number') {
                if (typeof window.showToast === 'function') {
                    window.showToast("Unable to verify your current credit balance. Please retry after your account syncs.", "warning");
                }
                return false;
            }
            if (state.credits < cost) {
                if (typeof window.showToast === 'function') {
                    window.showToast("Insufficient credits. Current balance: " + state.credits + " credits. Please top up.", "warning");
                }
                if (typeof window.openPurchaseModal === 'function') {
                    window.openPurchaseModal();
                }
                return false;
            }
        }

        return true;
    }
    window.hasSufficientCredits = hasSufficientCredits;

    // ============================================================
    // UI HELPERS
    // ============================================================
    function setButtonLoadingState(btnId, show, loadingText, defaultText) {
        const btn = $(btnId);
        if (!btn) return;
        if (show) {
            btn.disabled = true;
            btn.classList.add("opacity-70", "cursor-not-allowed");
            btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-[18px]">progress_activity</span><span>' + esc(loadingText) + '</span>';
        } else {
            btn.disabled = false;
            btn.classList.remove("opacity-70", "cursor-not-allowed");
            btn.innerHTML = '<span>' + esc(defaultText) + '</span>';
        }
    }

    function toggleLaserScanner(show) {
        const dz = $("dropzone");
        if (!dz) return;
        const existing = $("hudMatrixOverlay");
        if (show) {
            if (!existing) {
                const wrap = document.createElement("div");
                wrap.id = "hudMatrixOverlay";
                wrap.className = "absolute inset-0 z-40 overflow-hidden pointer-events-none rounded-2xl bg-black/40 backdrop-blur-[2px]";
                wrap.innerHTML = '<div class="absolute inset-0 bg-[linear-gradient(rgba(168,85,247,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.05)_1px,transparent_1px)] bg-[size:14px_14px] animate-pulse"></div>'
                    + '<div class="absolute top-2 left-2 flex items-center gap-2"><span class="flex h-2 w-2 rounded-full bg-violet-400 animate-ping"></span><span id="hudTickerText" class="text-neutral-500/50 font-mono text-[9px] tracking-widest uppercase font-bold">OCR_THREAD_ACTIVE // DECODING_CONTEXT // STRATEGY_LOCK</span></div>';
                dz.appendChild(wrap);

                let idx = 0;
                if (tickerInterval) clearInterval(tickerInterval);
                tickerInterval = setInterval(function () {
                    idx = (idx + 1) % TICKER_MESSAGES.length;
                    const t = $("hudTickerText");
                    if (t) t.textContent = TICKER_MESSAGES[idx];
                }, 400);
            }
        } else {
            if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
            if (existing) existing.remove();
        }
    }

    function startTelemetryTracker(type, statusElId, pctElId, barElId, messages) {
        const statusEl = $(statusElId);
        const pctEl = $(pctElId);
        const barEl = $(barElId);
        if (!statusEl || !pctEl || !barEl) return;

        let pct = 0;
        let msgIdx = 0;
        if (telemetryIntervals[type]) clearInterval(telemetryIntervals[type]);

        statusEl.textContent = messages[0];
        pctEl.textContent = "0%";
        barEl.style.width = "0%";

        telemetryIntervals[type] = setInterval(function () {
            if (pct < 40) pct += Math.floor(Math.random() * 8) + 5;
            else if (pct < 75) pct += Math.floor(Math.random() * 5) + 3;
            else if (pct < 95) pct += Math.floor(Math.random() * 2) + 1;
            if (pct > 95) pct = 95;

            pctEl.textContent = pct + "%";
            barEl.style.width = pct + "%";

            if (pct % 20 === 0 || Math.random() < 0.12) {
                msgIdx = (msgIdx + 1) % messages.length;
                statusEl.textContent = messages[msgIdx];
            }
        }, 180);
    }

    function stopTelemetryTracker(type, statusElId, pctElId, barElId, finalMessage) {
        if (telemetryIntervals[type]) {
            clearInterval(telemetryIntervals[type]);
            delete telemetryIntervals[type];
        }
        const statusEl = $(statusElId);
        const pctEl = $(pctElId);
        const barEl = $(barElId);
        if (statusEl) statusEl.textContent = finalMessage || "COMPLETE";
        if (pctEl) pctEl.textContent = "100%";
        if (barEl) barEl.style.width = "100%";
    }

    function clearAllTelemetry() {
        Object.keys(telemetryIntervals).forEach(function(key) {
            try { clearInterval(telemetryIntervals[key]); } catch (e) {}
        });
        for (const k in telemetryIntervals) delete telemetryIntervals[k];
    }
    window.clearAllTelemetry = clearAllTelemetry;
    window.addEventListener("beforeunload", clearAllTelemetry);

    // Radial score animator
    function animateRadialScoreCounter() {
        const tone = state.activeTone || "Witty";
        const data = TONE_HUD_MAP[tone] || TONE_HUD_MAP["Witty"];
        const targetVal = data.val;

        const bar = $("radial-progress-bar");
        const txt = $("radial-percentage-text");
        if (!bar || !txt) return;

        const circum = 113.1;
        bar.style.strokeDashoffset = circum.toString();
        txt.textContent = "0%";

        let startTime = null;
        const duration = 900;

        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const valNow = Math.floor(ease * targetVal);
            txt.textContent = valNow + "%";
            const offset = circum - (circum * (ease * targetVal) / 100);
            bar.style.strokeDashoffset = offset.toFixed(2);
            if (progress < 1) requestAnimationFrame(step);
            else {
                txt.textContent = targetVal + "%";
                const finalOffset = circum - (circum * targetVal / 100);
                bar.style.strokeDashoffset = finalOffset.toFixed(2);
            }
        }
        requestAnimationFrame(step);
    }

    window.updateHUDScoreBadge = function () {
        const tone = state.activeTone || "Witty";
        const data = TONE_HUD_MAP[tone] || TONE_HUD_MAP["Witty"];

        const bar = $("radial-progress-bar");
        const txt = $("radial-percentage-text");
        if (bar && txt) {
            txt.textContent = data.score;
            const circum = 113.1;
            const offset = circum - (circum * data.val / 100);
            bar.style.strokeDashoffset = offset.toFixed(2);
        }

        const stratTitle = $("strategy-title-target");
        if (stratTitle) stratTitle.textContent = data.strategy;

        const b1 = $("card-badge-1"), b2 = $("card-badge-2"), b3 = $("card-badge-3");
        if (b1) b1.textContent = data.card1 + " Success Rate";
        if (b2) b2.textContent = data.card2 + " Success Rate";
        if (b3) b3.textContent = data.card3 + " Success Rate";
    };

    // ============================================================
    // IMAGE PROCESSING & CROPPER
    // ============================================================
    async function convertHeicIfNeeded(file) {
        if (!file) return file;
        const name = (file.name || "screenshot.jpg").toLowerCase();
        const type = (file.type || "").toLowerCase();
        if (type.includes("heic") || type.includes("heif") || type.includes("quicktime") || name.endsWith(".heic") || name.endsWith(".heif")) {
            if (window.heic2any) {
                try {
                    const convertedBlob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.88 });
                    const singleBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                    const newFileName = (name.endsWith(".heic") || name.endsWith(".heif")) ? name.replace(/\.(heic|heif)$/i, ".jpg") : name + ".jpg";
                    return new File([singleBlob], newFileName, { type: "image/jpeg" });
                } catch (e) {
                    console.warn("HEIC conversion warning:", e);
                }
            } else {
                if (typeof window.showToast === 'function') {
                    window.showToast("iOS HEIC images require conversion. Please save as JPEG or PNG.", "info");
                }
            }
        }
        return file;
    }

    function processImageToJpegDataUrl(file) {
        return new Promise(function (resolve) {
            const reader = new FileReader();
            reader.onload = function (ev) {
                const img = new Image();
                img.onload = function () {
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    const canvas = document.createElement("canvas");
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL("image/jpeg", 0.88));
                };
                img.onerror = function () { resolve(ev.target.result); };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    window.processSelectedFiles = async function (fileList) {
        if (!fileList || fileList.length === 0) return;
        const filesArray = Array.from(fileList);
        const validFiles = filesArray.filter(function (f) {
            const n = (f.name || "").toLowerCase();
            return f.type.startsWith("image/") || f.type.includes("heic") || f.type.includes("heif") || n.endsWith(".heic") || n.endsWith(".heif");
        });

        if (validFiles.length === 0) {
            window.showToast("Please select valid chat screenshot images.", "warning");
            return;
        }

        if (state.uploadedFiles.length + validFiles.length > 5) {
            window.showToast("You can analyze a maximum of 5 images at a time.", "warning");
            return;
        }

        let currentBatchBytes = 0;
        for (let s = 0; s < validFiles.length; s++) {
            if (validFiles[s].size > 5 * 1024 * 1024) {
                window.showToast("Image is too large. Maximum size is 5 MB per image.", "warning");
                return;
            }
            currentBatchBytes += validFiles[s].size;
        }

        if (currentBatchBytes > 25 * 1024 * 1024) {
            window.showToast("These images are too large. Maximum total upload size: 25 MB.", "warning");
            return;
        }

        const si = $("screenshotInput");
        if (si) si.value = "";

        if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
        }
        window.focus();

        try {
            const totalFilesToProcess = validFiles.length;
            const isSingleNewUpload = (totalFilesToProcess === 1 && state.uploadedFiles.length === 0);

            for (let i = 0; i < validFiles.length; i++) {
                if (state.uploadedFiles.length < 5) {
                    const procFile = await convertHeicIfNeeded(validFiles[i]);
                    const dUrl = await processImageToJpegDataUrl(procFile);
                    state.uploadedFiles.push(dUrl);
                }
            }
            renderThumbnailGrid();
            window.setLifecycleState("SELECTED");
            window.updateButtonStates();
            window.showToast(validFiles.length + " screenshot(s) loaded! Click 'Generate Perfect Replies' or tap an image to edit.", "success");
        } catch (err) {
            console.error("Error processing screenshots:", err);
            window.showToast("Error processing image. Please try again.", "error");
        }
    };

    window.addEventListener("paste", function (e) {
        if (!e.clipboardData) return;

        const pastedFiles = [];

        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            const files = Array.from(e.clipboardData.files);
            files.forEach(function (f) {
                const type = (f.type || "").toLowerCase();
                const name = (f.name || "").toLowerCase();
                if (type.startsWith("image/") || type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif")) {
                    pastedFiles.push(f);
                }
            });
        }

        if (pastedFiles.length === 0 && e.clipboardData.items) {
            const items = Array.from(e.clipboardData.items);
            items.forEach(function (it) {
                if (it.type && (it.type.startsWith("image/") || it.type.includes("heic") || it.type.includes("heif"))) {
                    const f = it.getAsFile();
                    if (f) pastedFiles.push(f);
                }
            });
        }

        if (pastedFiles.length > 0) {
            if (!state.isTermsAccepted) {
                window.highlightTermsCheckbox();
                window.showToast("Please agree to the Terms of Service & Privacy Protocol box first to unlock tools!", "warning");
                return;
            }
            window.processSelectedFiles(pastedFiles);
            window.showToast("Pasted screenshot from clipboard!", "success");
        }
    });

    window.editThumbnail = function (index, e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (state.lifecycle === "ANALYZING") {
            window.showToast("Analysis is in progress. Please wait for completion!", "warning");
            return;
        }
        if (window._wingmanDragJustFinished) return;
        const idx = typeof index === 'number' ? index : parseInt(index, 10);
        if (!isNaN(idx) && idx >= 0 && idx < state.uploadedFiles.length) {
            window.openCropModalWithDataUrl(state.uploadedFiles[idx], idx);
        }
    };

    function updateCreditCostLabel() {
        const ccl = $("creditCostLabel");
        if (ccl) {
            ccl.textContent = "Consumes 10 Credits";
        }
    }

    function renderThumbnailGrid() {
        const grid = $("thumbnailGrid");
        const de = $("dropzoneEmpty"), dp = $("dropzonePreview");
        const lbl = $("uploadedCountLabel");

        if (state.uploadedFiles.length === 0) {
            if (de) de.classList.remove("hidden");
            if (dp) dp.classList.add("hidden");
            if (state.lifecycle !== "ANALYZING" && state.lifecycle !== "REVEALED") {
                window.setLifecycleState("EMPTY");
            }
        } else {
            if (de) de.classList.add("hidden");
            if (dp) dp.classList.remove("hidden");
            if (lbl) lbl.textContent = state.uploadedFiles.length + " / 5 Screenshots Loaded";

            if (grid) {
                grid.innerHTML = "";
                const cardEls = [];
                state.uploadedFiles.forEach(function (url, index) {
                    const thumb = document.createElement("div");
                    thumb.className = "relative aspect-[3/4] rounded-xl overflow-hidden border border-white/25 bg-black group cursor-pointer hover:border-violet-400 transition-all shadow-md select-none";
                    thumb.style.touchAction = "none";
                    thumb.setAttribute("data-thumb-index", String(index));
                    thumb.setAttribute("onclick", "window.editThumbnail(" + index + ", event)");

                    const safeUrl = (typeof url === 'string' && url.startsWith('data:image/')) ? url : '';
                    const isLast = index === state.uploadedFiles.length - 1;
                    const badgeText = state.uploadedFiles.length > 1
                        ? (index === 0 ? "#1 (Oldest)" : (isLast ? "#" + (index + 1) + " (Latest)" : "#" + (index + 1)))
                        : "#1";
                    const badgeStyle = (isLast && state.uploadedFiles.length > 1)
                        ? "bg-violet-600 border-violet-400 text-white shadow-[0_0_10px_rgba(139,92,246,0.6)]"
                        : "bg-black/80 border-white/20 text-slate-300";

                    thumb.innerHTML = '<div class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold border z-10 pointer-events-none ' + badgeStyle + '">' + badgeText + '</div>'
                        + '<img src="' + safeUrl + '" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 pointer-events-none" draggable="false"/>'
                        + '<div class="absolute inset-0 bg-violet-950/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity pointer-events-none gap-1 p-1 text-center">'
                        + '<span class="material-symbols-outlined text-white text-[20px] bg-black/70 p-1.5 rounded-full border border-violet-400/60 shadow-lg">crop</span>'
                        + '<span class="text-[9px] font-bold text-white uppercase tracking-wider bg-black/70 px-1.5 py-0.5 rounded">Click to Edit</span></div>'
                        + '<button type="button" onclick="window.removeThumbnail(' + index + ', event)" class="absolute top-1.5 right-1.5 bg-red-600/90 hover:bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md opacity-90 hover:opacity-100 transition-opacity z-10" title="Delete Screenshot">'
                        + '<span class="material-symbols-outlined text-[13px]">close</span></button>';
                    grid.appendChild(thumb);
                    cardEls.push(thumb);
                });

                // Drag reorder (lightweight)
                (function setupGridDrag(g, cards) {
                    let srcIdx = -1, ghost = null, rects = [];
                    let lx = 0, ly = 0, sx = 0, sy = 0;
                    let moved = false, hoverIdx = -1;

                    g.addEventListener("pointerdown", function(e) {
                        if (e.button !== 0 || e.target.closest("button") || state.lifecycle === "ANALYZING") return;
                        const card = e.target.closest("[data-thumb-index]");
                        if (!card) return;
                        srcIdx = parseInt(card.getAttribute("data-thumb-index"), 10);
                        sx = lx = e.clientX; sy = ly = e.clientY;
                        moved = false; hoverIdx = -1;
                        rects = [];
                        for (let i = 0; i < cards.length; i++) {
                            const cr = cards[i].getBoundingClientRect();
                            rects.push({ l: cr.left, r: cr.right, t: cr.top, b: cr.bottom });
                        }
                    });

                    g.addEventListener("pointermove", function(e) {
                        if (srcIdx < 0) return;
                        lx = e.clientX; ly = e.clientY;

                        if (!moved) {
                            if (Math.abs(lx - sx) < 8 && Math.abs(ly - sy) < 8) return;
                            moved = true;
                            try { g.setPointerCapture(e.pointerId); } catch(er) {}
                            cards[srcIdx].style.opacity = "0.2";
                            cards[srcIdx].style.filter = "grayscale(1)";
                            ghost = document.createElement("div");
                            ghost.style.cssText = "position:fixed;z-index:9999;pointer-events:none;"
                                + "width:56px;height:72px;border-radius:10px;"
                                + "background:linear-gradient(135deg,#7c3aed,#a78bfa);"
                                + "border:2px solid #c4b5fd;opacity:0.92;"
                                + "box-shadow:0 8px 24px rgba(124,58,237,0.5);"
                                + "display:flex;align-items:center;justify-content:center;"
                                + "font-size:14px;font-weight:800;color:#fff;font-family:monospace;"
                                + "left:" + (lx - 28) + "px;top:" + (ly - 36) + "px;";
                            ghost.textContent = "#" + (srcIdx + 1);
                            document.body.appendChild(ghost);
                        }

                        if (moved && e.cancelable) e.preventDefault();

                        if (ghost) {
                            ghost.style.left = (lx - 28) + "px";
                            ghost.style.top = (ly - 36) + "px";
                        }

                        let newHover = -1;
                        for (let i = 0; i < rects.length; i++) {
                            if (i === srcIdx) continue;
                            if (lx >= rects[i].l && lx <= rects[i].r && ly >= rects[i].t && ly <= rects[i].b) {
                                newHover = i; break;
                            }
                        }
                        if (newHover !== hoverIdx) {
                            if (hoverIdx >= 0 && hoverIdx < cards.length) cards[hoverIdx].style.outline = "";
                            hoverIdx = newHover;
                            if (hoverIdx >= 0 && hoverIdx < cards.length) cards[hoverIdx].style.outline = "2.5px solid #a78bfa";
                        }
                    });

                    function finish(e) {
                        if (srcIdx < 0) return;
                        try { g.releasePointerCapture(e.pointerId); } catch(er) {}

                        let tgt = -1;
                        if (moved) {
                            for (let i = 0; i < rects.length; i++) {
                                if (i === srcIdx) continue;
                                if (lx >= rects[i].l && lx <= rects[i].r && ly >= rects[i].t && ly <= rects[i].b) {
                                    tgt = i; break;
                                }
                            }
                        }

                        if (ghost) { ghost.remove(); ghost = null; }
                        for (let j = 0; j < cards.length; j++) {
                            cards[j].style.opacity = "";
                            cards[j].style.filter = "";
                            cards[j].style.outline = "";
                        }

                        let didReorder = false;
                        if (moved && tgt >= 0 && tgt !== srcIdx && srcIdx < state.uploadedFiles.length) {
                            const item = state.uploadedFiles.splice(srcIdx, 1)[0];
                            state.uploadedFiles.splice(tgt, 0, item);
                            didReorder = true;
                        }

                        if (moved) {
                            window._wingmanDragJustFinished = true;
                            setTimeout(function() { window._wingmanDragJustFinished = false; }, 300);
                        }

                        const finalTgt = tgt;
                        srcIdx = -1; moved = false; hoverIdx = -1; rects = [];

                        if (didReorder) {
                            renderThumbnailGrid();
                            window.showToast("Moved screenshot to slot #" + (finalTgt + 1), "info");
                        }
                    }

                    g.addEventListener("pointerup", finish);
                    g.addEventListener("pointercancel", finish);
                })(grid, cardEls);
            }
        }
        updateCreditCostLabel();
        window.updateButtonStates();
    }

    window.removeThumbnail = function (index, e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (state.lifecycle === "ANALYZING") {
            window.showToast("Analysis is in progress. Please wait for completion!", "warning");
            return;
        }
        state.uploadedFiles.splice(index, 1);
        renderThumbnailGrid();
    };

    window.triggerAddMoreImages = function (e) {
        if (state.isLoading || state.lifecycle === "ANALYZING") {
            window.showToast("Analysis is in progress. Please wait for completion!", "warning");
            return;
        }
        if (state.uploadedFiles.length >= 5) {
            window.showToast("Maximum of 5 screenshots reached per analysis batch.", "warning");
            return;
        }
        const si = $("screenshotInput") || document.getElementById("screenshotInput");
        if (si && e && e.target === si) return;
        if (si) {
            si.removeAttribute("disabled");
            si.disabled = false;
            si.click();
        }
    };

    window.triggerDropzoneClick = function (e) {
        if (state.isLoading || state.lifecycle === "ANALYZING") {
            window.showToast("Analysis is in progress. Please wait for completion!", "warning");
            return;
        }
        if (window._wingmanDragJustFinished) return;

        const si = $("screenshotInput") || document.getElementById("screenshotInput");
        if (si && e && e.target === si) return;

        if (e && (
            e.target.closest("button:not(#addMoreScreenshotsBtn)") ||
            e.target.closest("[title='Delete Screenshot']") ||
            e.target.closest(".thumbnail-card") ||
            e.target.closest("[data-thumb-index]") ||
            e.target.closest("#dropzonePreview") ||
            e.target.closest(".crop-btn")
        )) {
            return;
        }

        if (state.uploadedFiles.length >= 5) {
            window.showToast("Maximum of 5 screenshots reached per analysis batch.", "warning");
            return;
        }

        if (si) {
            si.removeAttribute("disabled");
            si.disabled = false;
            si.click();
        }
    };

    // ============================================================
    // CROPPER MODAL
    // ============================================================
    window.editingImageIndex = null;
    let currentWorkingCropperDataUrl = null;
    window.cropperCurrentAngle = 0;

    function rotateImageDataUrl(dataUrl, totalDegrees) {
        return new Promise(function (resolve) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = function () {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                let angle = ((totalDegrees % 360) + 360) % 360;

                if (angle === 90 || angle === 270) {
                    canvas.width = img.height;
                    canvas.height = img.width;
                } else {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }

                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.rotate(angle * Math.PI / 180);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);

                resolve(canvas.toDataURL("image/jpeg", 0.92));
            };
            img.onerror = function () { resolve(dataUrl); };
            img.src = dataUrl;
        });
    }

    function initCropperOnTargetImage(targetImg) {
        if (activeCropperInstance) {
            activeCropperInstance.destroy();
            activeCropperInstance = null;
        }

        if (window.Cropper) {
            setTimeout(function () {
                activeCropperInstance = new Cropper(targetImg, {
                    viewMode: 1,
                    dragMode: 'crop',
                    autoCropArea: 1.0,
                    restore: false,
                    modal: true,
                    guides: true,
                    highlight: true,
                    cropBoxMovable: true,
                    cropBoxResizable: true,
                    toggleDragModeOnDblclick: false,
                    responsive: true,
                    zoomable: true,
                    zoomOnTouch: true,
                    zoomOnWheel: true,
                    background: false,
                    checkOrientation: false,
                    ready: function () {
                        try {
                            const cropper = this.cropper;
                            if (cropper) {
                                const canvasData = cropper.getCanvasData();
                                if (canvasData && canvasData.width && canvasData.height) {
                                    cropper.setCropBoxData({
                                        left: canvasData.left,
                                        top: canvasData.top,
                                        width: canvasData.width,
                                        height: canvasData.height
                                    });
                                }
                            }
                        } catch (err) {}
                    }
                });
            }, 80);
        }
    }

    window.openCropModalWithDataUrl = function (dataUrl, targetIndex) {
        currentUploadedRawDataUrl = dataUrl;
        currentWorkingCropperDataUrl = dataUrl;
        window.cropperCurrentAngle = 0;
        window.editingImageIndex = (typeof targetIndex === 'number' && targetIndex >= 0) ? targetIndex : null;

        const targetImg = $("cropperTargetImage") || document.getElementById("cropperTargetImage");
        const cm = $("cropModal") || document.getElementById("cropModal");
        const cc = $("cropCard") || document.getElementById("cropCard");
        if (!targetImg || !cm || !cc) return;

        targetImg.crossOrigin = "anonymous";
        targetImg.onload = function () {
            initCropperOnTargetImage(targetImg);
        };
        targetImg.src = dataUrl;
        cm.style.display = "flex";
        cm.style.removeProperty("visibility");
        cm.classList.remove("opacity-0", "pointer-events-none", "hidden");
        cm.classList.add("opacity-100", "pointer-events-auto");
        cc.classList.remove("scale-95");
        cc.classList.add("scale-100");
    };

    window.closeCropModal = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const cm = $("cropModal") || document.getElementById("cropModal");
        const cc = $("cropCard") || document.getElementById("cropCard");

        try {
            if (cc) {
                cc.classList.remove("scale-100");
                cc.classList.add("scale-95");
            }
            if (cm) {
                cm.classList.remove("opacity-100", "pointer-events-auto");
                cm.classList.add("opacity-0", "pointer-events-none", "hidden");
                cm.style.display = "none";
                cm.style.setProperty("display", "none", "important");
                cm.style.visibility = "hidden";
            }
        } catch (err) {}

        try {
            if (activeCropperInstance) {
                activeCropperInstance.destroy();
            }
        } catch (err) {}

        activeCropperInstance = null;
        window.editingImageIndex = null;
        currentWorkingCropperDataUrl = null;
        window.cropperCurrentAngle = 0;
    };

    window.cropperRotate = async function (deg) {
        const step = deg || 90;
        window.cropperCurrentAngle = (window.cropperCurrentAngle + step) % 360;

        const targetImg = $("cropperTargetImage");
        if (!targetImg || !currentUploadedRawDataUrl) return;

        if (activeCropperInstance) {
            activeCropperInstance.destroy();
            activeCropperInstance = null;
        }

        if (window.cropperCurrentAngle === 0) {
            currentWorkingCropperDataUrl = currentUploadedRawDataUrl;
            targetImg.onload = function () { initCropperOnTargetImage(targetImg); };
            targetImg.src = currentUploadedRawDataUrl;
        } else {
            const rotatedUrl = await rotateImageDataUrl(currentUploadedRawDataUrl, window.cropperCurrentAngle);
            currentWorkingCropperDataUrl = rotatedUrl;
            targetImg.onload = function () { initCropperOnTargetImage(targetImg); };
            targetImg.src = rotatedUrl;
        }
    };

    window.cropperReset = function () {
        window.cropperCurrentAngle = 0;
        currentWorkingCropperDataUrl = currentUploadedRawDataUrl;
        const targetImg = $("cropperTargetImage");
        if (!targetImg || !currentUploadedRawDataUrl) return;

        if (activeCropperInstance) {
            activeCropperInstance.destroy();
            activeCropperInstance = null;
        }

        targetImg.onload = function () { initCropperOnTargetImage(targetImg); };
        targetImg.src = currentUploadedRawDataUrl;
    };

    window.confirmCrop = async function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        try {
            let croppedDataUrl = null;

            const targetImg = $("cropperTargetImage") || document.getElementById("cropperTargetImage");

            if (activeCropperInstance) {
                try {
                    const cv = activeCropperInstance.getCroppedCanvas({
                        maxWidth: 2048,
                        maxHeight: 2048,
                        fillColor: '#000000'
                    });
                    if (cv) {
                        croppedDataUrl = cv.toDataURL("image/jpeg", 0.88);
                    }
                } catch (cropErr) {
                    console.warn("Canvas crop fallback engaged:", cropErr);
                }
            }

            if (!croppedDataUrl || croppedDataUrl.length < 100) {
                croppedDataUrl = currentWorkingCropperDataUrl || currentUploadedRawDataUrl || (targetImg ? targetImg.src : null);
            }

            if (croppedDataUrl && croppedDataUrl.length > 50) {
                if (typeof window.editingImageIndex === 'number' && window.editingImageIndex !== null && window.editingImageIndex >= 0 && window.editingImageIndex < state.uploadedFiles.length) {
                    state.uploadedFiles[window.editingImageIndex] = croppedDataUrl;
                } else if (state.uploadedFiles.length < 5) {
                    state.uploadedFiles.push(croppedDataUrl);
                    state.croppedWebpDataUrl = croppedDataUrl;
                } else {
                    state.uploadedFiles[state.uploadedFiles.length - 1] = croppedDataUrl;
                    state.croppedWebpDataUrl = croppedDataUrl;
                }
                renderThumbnailGrid();
                window.setLifecycleState("SELECTED");
                window.updateButtonStates();
                if (typeof window.showToast === 'function') {
                    window.showToast("Screenshot saved and added to analysis queue!", "success");
                }
            }
        } catch (err) {
            console.error("confirmCrop Error:", err);
        } finally {
            window.editingImageIndex = null;
            window.closeCropModal();
        }
    };

    // ============================================================
    // ROUTING TABS & LIFECYCLE
    // ============================================================
    window.switchTab = function (tabId) {
        try {
            const mainEl = document.querySelector("main");
            if (mainEl) {
                if (tabId === "chatboxSection") {
                    mainEl.classList.remove("max-w-7xl", "p-4", "md:p-6");
                    mainEl.style.setProperty("padding-left", "0px", "important");
                    mainEl.style.setProperty("padding-right", "0px", "important");
                    mainEl.style.setProperty("padding-top", "0px", "important");
                    mainEl.style.setProperty("max-width", "100%", "important");
                } else {
                    mainEl.classList.add("max-w-7xl", "p-4", "md:p-6");
                    mainEl.style.removeProperty("padding-left");
                    mainEl.style.removeProperty("padding-right");
                    mainEl.style.removeProperty("padding-top");
                    mainEl.style.removeProperty("max-width");
                }
            }

            const tabs = ["analyzeSection", "icebreakSection", "optimizeSection", "chatboxSection"];

            if (tabId === "chatboxSection") {
                const container = $("chatbox-messages-container");
                if (!container || container.querySelectorAll(".animate-chat-bubble").length === 0) {
                    if (typeof window.clearAndResetChatbox === "function") window.clearAndResetChatbox();
                }
            } else {
                document.body.classList.remove("chat-keyboard-open");
                if (typeof window.resetPracticeChat === "function") window.resetPracticeChat();
            }

            tabs.forEach(function (s) {
                const el = $(s);
                if (!el) return;
                if (s === tabId) {
                    el.classList.remove("hidden");
                    el.style.setProperty("display", "flex", "important");
                    el.classList.add("flex");
                } else {
                    el.classList.add("hidden");
                    el.classList.remove("flex");
                    el.style.setProperty("display", "none", "important");
                }
            });

            document.querySelectorAll(".nav-tab-desktop").forEach(function (btn) {
                const isTarget = btn.getAttribute("data-tab") === tabId;
                if (isTarget) {
                    btn.classList.add("active-tab", "text-white", "bg-violet-600/30", "border-violet-500/40", "shadow-[0_4px_15px_-3px_rgba(139,92,246,0.3)]");
                    btn.classList.remove("text-slate-300", "hover:text-white", "hover:bg-white/5");
                } else {
                    btn.classList.remove("active-tab", "text-white", "bg-violet-600/30", "border-violet-500/40", "shadow-[0_4px_15px_-3px_rgba(139,92,246,0.3)]");
                    btn.classList.add("text-slate-300", "hover:text-white", "hover:bg-white/5");
                }
                const icon = btn.querySelector(".material-symbols-outlined");
                if (icon) icon.style.fontVariationSettings = isTarget ? "'FILL' 1" : "'FILL' 0";
            });

            document.querySelectorAll(".nav-tab-mobile").forEach(function (btn) {
                const isTarget = btn.getAttribute("data-tab") === tabId;
                btn.className = isTarget
                    ? "nav-tab-mobile active-tab flex flex-col items-center justify-center text-violet-300 bg-violet-600/20 rounded-xl p-2 scale-95 transition-all duration-200 flex-1"
                    : "nav-tab-mobile flex flex-col items-center justify-center text-slate-400 p-2 hover:text-violet-300 transition-colors flex-1";
                const icon = btn.querySelector(".material-symbols-outlined");
                if (icon) icon.style.fontVariationSettings = isTarget ? "'FILL' 1" : "'FILL' 0";
            });

            state.activeTab = tabId;
            saveSessionState();

            // Mobile tabs must open at their own top; retaining the previous tab's
            // scroll offset hides section headers and makes the workspace look incomplete.
            if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
                requestAnimationFrame(function () {
                    const mainCanvas = document.getElementById('mainContentCanvas') || document.querySelector('main');
                    try {
                        if (mainCanvas && typeof mainCanvas.scrollTo === 'function') {
                            mainCanvas.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                        }
                    } catch (e) {}
                    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }
                });
            }
        } catch (e) {}
    };

    window.setLifecycleState = function (phase) {
        state.lifecycle = phase;
        const stateLbl = $("lifecycleStateLabel");
        if (stateLbl) stateLbl.textContent = phase;

        const empty = $("analyzeEmptyState");
        const skel = $("analyzeSkeletonState");
        const res = $("analyzeResultsState");
        const btn = $("runAnalysisBtn");
        const scannerContainer = $("screenshotPreviewContainer");
        const dzContainer = $("dropzoneContainer");
        const si = $("screenshotInput");

        if (phase === "EMPTY") {
            toggleLaserScanner(false);
            if (scannerContainer) scannerContainer.classList.remove("is-analyzing");
            if (empty) empty.classList.remove("hidden");
            if (skel) skel.classList.add("hidden");
            if (res) res.classList.add("hidden");
            if (dzContainer) dzContainer.classList.remove("pointer-events-none", "opacity-60");
            if (si && state.isTermsAccepted) si.disabled = false;
        } else if (phase === "SELECTED") {
            toggleLaserScanner(false);
            if (scannerContainer) scannerContainer.classList.remove("is-analyzing");
            if (empty) empty.classList.remove("hidden");
            if (skel) skel.classList.add("hidden");
            if (res) res.classList.add("hidden");
            if (dzContainer) dzContainer.classList.remove("pointer-events-none", "opacity-60");
            if (si && state.isTermsAccepted) si.disabled = false;
        } else if (phase === "ANALYZING") {
            toggleLaserScanner(true);
            if (scannerContainer) scannerContainer.classList.add("is-analyzing");
            if (empty) empty.classList.add("hidden");
            if (skel) skel.classList.remove("hidden");
            if (res) res.classList.add("hidden");
            if (dzContainer) dzContainer.classList.add("pointer-events-none", "opacity-60");
            if (si) si.disabled = true;
        } else if (phase === "REVEALED") {
            toggleLaserScanner(false);
            if (scannerContainer) scannerContainer.classList.remove("is-analyzing");
            if (empty) empty.classList.add("hidden");
            if (skel) skel.classList.add("hidden");
            if (dzContainer) dzContainer.classList.remove("pointer-events-none", "opacity-60");
            if (si && state.isTermsAccepted) si.disabled = false;
            if (res) {
                res.classList.remove("hidden");
                res.classList.remove("animate-results-reveal");
                void res.offsetWidth;
                res.classList.add("animate-results-reveal");

                const children = Array.from(res.children);
                children.forEach(function (child) {
                    child.style.animationDelay = "0ms";
                    child.style.transform = "none";
                    child.style.opacity = "1";
                });

                if (children[1]) {
                    children[1].classList.remove("animate-hero-glow");
                    void children[1].offsetWidth;
                    children[1].classList.add("animate-hero-glow");
                }
            }
            animateRadialScoreCounter();
        }
        window.updateButtonStates();
        saveSessionState();
    };

    window.updateTermsLockState = function () {
        try {
            const isLocked = !state.isTermsAccepted;

            const cb = $("privacyConsent");
            if (cb) {
                cb.checked = Boolean(state.isTermsAccepted);
            }

            const dz = $("dropzone");
            const si = $("screenshotInput");

            if (dz) {
                dz.classList.toggle("opacity-40", isLocked);
                dz.classList.toggle("cursor-not-allowed", isLocked);
            }
            if (si) si.disabled = isLocked;

            window.updateButtonStates();
        } catch (e) {}
    };

    window.updateButtonStates = function () {
        try {
            const isLocked = !state.isTermsAccepted;
            const isLoading = !!state.isLoading;
            const isAuth = safeStorage.get("wingman_authenticated") === "true" || safeStorage.get("wingman_user_authenticated") === "true" || (typeof window.currentSupabaseUser === 'object' && window.currentSupabaseUser);

            const isCreditsBlocked10 = !isAuth || isLocked || state.creditsStatus === "loading" || state.creditsStatus === "error" || state.creditsStatus === "missing_profile" || state.creditsStatus === "idle" || state.credits === null || (typeof state.credits === 'number' && state.credits < 10);
            const isCreditsBlocked2 = !isAuth || isLocked || state.creditsStatus === "loading" || state.creditsStatus === "error" || state.creditsStatus === "missing_profile" || state.creditsStatus === "idle" || state.credits === null || (typeof state.credits === 'number' && state.credits < 2);

            const bi = $("bioInput");
            const btn2 = $("generateIcebreakerBtn");
            const bioCounter = $("bioCharCounter");
            if (bi && bioCounter) {
                const len = bi.value.length;
                bioCounter.textContent = `${len.toLocaleString()} / 5,000`;
                bioCounter.style.color = len > 5000 ? '#ef4444' : (len > 4500 ? '#f59e0b' : 'rgba(148, 163, 184, 0.6)');
            }
            if (btn2) {
                const isBioValid = bi && bi.value.trim().length >= 5 && bi.value.length <= 5000;
                const isBtn2Disabled = isLocked || !isBioValid || isLoading || isCreditsBlocked10;
                btn2.disabled = isBtn2Disabled;
                btn2.classList.toggle("opacity-40", isLocked || !isBioValid || isCreditsBlocked10);
                btn2.classList.toggle("opacity-70", isLoading);
                btn2.classList.toggle("cursor-not-allowed", isBtn2Disabled);
                btn2.classList.toggle("cursor-pointer", !isBtn2Disabled);

                const btn2Span = btn2.querySelector("span:not(.material-symbols-outlined)");
                if (btn2Span && !isLoading) {
                    if (!state.isTermsAccepted) {
                        btn2Span.textContent = "Generate Icebreaker — 10 Credits";
                    } else if (!isAuth) {
                        btn2Span.textContent = "Sign in to generate";
                    } else if (state.creditsStatus === "loading" || state.credits === null) {
                        btn2Span.textContent = "Checking credits…";
                    } else if (state.creditsStatus === "missing_profile") {
                        btn2Span.textContent = "Profile missing — Contact support";
                    } else if (state.creditsStatus === "error") {
                        btn2Span.textContent = "Credit service unavailable — Retry";
                    } else if (typeof state.credits === 'number' && state.credits < 10) {
                        btn2Span.textContent = `Add credits to generate (${state.credits}/10)`;
                    } else if (!isBioValid) {
                        btn2Span.textContent = "Enter match bio to generate";
                    } else {
                        btn2Span.textContent = "Generate Icebreaker — 10 Credits";
                    }
                }
            }

            const ai = $("auditBioInput");
            const btn3 = $("runAuditBtn");
            const auditCounter = $("auditBioCharCounter");
            if (ai && auditCounter) {
                const words = countWords(ai.value);
                auditCounter.textContent = `${words} / 500 words`;
                auditCounter.style.color = words > 500 ? '#ef4444' : (words > 450 ? '#f59e0b' : 'rgba(148, 163, 184, 0.6)');
            }
            if (btn3) {
                const words = ai ? countWords(ai.value) : 0;
                const isAuditValid = ai && ai.value.trim().length >= 5 && words <= 500;
                const isBtn3Disabled = isLocked || !isAuditValid || isLoading || isCreditsBlocked10;
                btn3.disabled = isBtn3Disabled;
                btn3.classList.toggle("opacity-40", isLocked || !isAuditValid || isCreditsBlocked10);
                btn3.classList.toggle("opacity-70", isLoading);
                btn3.classList.toggle("cursor-not-allowed", isBtn3Disabled);
                btn3.classList.toggle("cursor-pointer", !isBtn3Disabled);

                const btn3Span = btn3.querySelector("span:not(.material-symbols-outlined)");
                if (btn3Span && !isLoading) {
                    if (!state.isTermsAccepted) {
                        btn3Span.textContent = "Optimize My Bio — 10 Credits";
                    } else if (!isAuth) {
                        btn3Span.textContent = "Sign in to generate";
                    } else if (state.creditsStatus === "loading" || state.credits === null) {
                        btn3Span.textContent = "Checking credits…";
                    } else if (state.creditsStatus === "missing_profile") {
                        btn3Span.textContent = "Profile missing — Contact support";
                    } else if (state.creditsStatus === "error") {
                        btn3Span.textContent = "Credit service unavailable — Retry";
                    } else if (typeof state.credits === 'number' && state.credits < 10) {
                        btn3Span.textContent = `Add credits to generate (${state.credits}/10)`;
                    } else if (!isAuditValid) {
                        btn3Span.textContent = words > 500 ? "Bio exceeds 500 words" : "Enter your bio to optimize";
                    } else {
                        btn3Span.textContent = "Optimize My Bio — 10 Credits";
                    }
                }
            }

            const ci = $("simulator-chat-input");
            const chatCounter = $("chatCharCounter");
            if (ci && chatCounter) {
                const len = ci.value.length;
                chatCounter.textContent = `${len.toLocaleString()} / 5,000`;
                chatCounter.style.color = len > 5000 ? '#ef4444' : (len > 4500 ? '#f59e0b' : 'rgba(192, 132, 252, 0.6)');
            }

            const chatSendBtn = $("chatbox-send-btn");
            if (chatSendBtn) {
                const isChatDisabled = isLoading || !(ci && ci.value.trim().length > 0);
                chatSendBtn.disabled = isChatDisabled;
                chatSendBtn.classList.toggle("opacity-40", isChatDisabled);
                chatSendBtn.classList.toggle("cursor-not-allowed", isChatDisabled);
                chatSendBtn.classList.toggle("cursor-pointer", !isChatDisabled);
            }
            if (ci) {
                ci.disabled = isLoading;
            }

            const btn1 = $("runAnalysisBtn");
            if (btn1) {
                const count = Array.isArray(state.uploadedFiles) ? state.uploadedFiles.length : 0;
                const hasScreenshot = count >= 1 || Boolean(state.activeTranscriptCache);
                const withinLimit = count <= 5;
                const notLoading = !state.isLoading;

                const enabled = hasScreenshot && withinLimit && notLoading && !isCreditsBlocked10;
                btn1.disabled = !enabled;
                btn1.classList.toggle("opacity-40", !hasScreenshot || !withinLimit || isCreditsBlocked10);
                btn1.classList.toggle("opacity-70", Boolean(state.isLoading));
                btn1.classList.toggle("cursor-not-allowed", !enabled);
                btn1.classList.toggle("cursor-pointer", enabled);

                const btn1Span = btn1.querySelector("span:not(.material-symbols-outlined)");
                if (btn1Span && !state.isLoading) {
                    if (!state.isTermsAccepted) {
                        btn1Span.textContent = "Generate Perfect Replies — 10 Credits";
                    } else if (!isAuth) {
                        btn1Span.textContent = "Sign in to generate";
                    } else if (state.creditsStatus === "loading" || state.credits === null) {
                        btn1Span.textContent = "Checking credits…";
                    } else if (state.creditsStatus === "missing_profile") {
                        btn1Span.textContent = "Profile missing — Contact support";
                    } else if (state.creditsStatus === "error") {
                        btn1Span.textContent = "Credit service unavailable — Retry";
                    } else if (typeof state.credits === 'number' && state.credits < 10) {
                        btn1Span.textContent = `Add credits to generate (${state.credits}/10)`;
                    } else if (!hasScreenshot) {
                        btn1Span.textContent = "Upload screenshot to generate";
                    } else {
                        btn1Span.textContent = "Generate Perfect Replies — 10 Credits";
                    }
                }
            }
        } catch (err) {
            console.error("Button states update error:", err);
        }
    };

    // ============================================================
    // STYLE SELECTORS
    // ============================================================
    window.selectTone = function (target, toneVal) {
        const container = document.getElementById("analyzeToneContainer");
        if (container) {
            const chips = container.querySelectorAll(".tone-chip");
            chips.forEach(function (c) {
                c.classList.remove("active");
                c.style.removeProperty("background");
                c.style.removeProperty("border-color");
                c.style.removeProperty("color");
            });
        }
        const chip = (typeof target === "string") ? document.getElementById(target) : target;
        if (chip) chip.classList.add("active");
        state.activeTone = toneVal;
        state.selectedTone = toneVal;
        window.updateHUDScoreBadge();
        saveSessionState();
    };

    window.selectVibe = function (target, vibeVal) {
        const container = document.getElementById("vibeContainer");
        if (container) {
            const chips = container.querySelectorAll(".vibe-chip");
            chips.forEach(function (c) {
                c.classList.remove("active");
                c.style.removeProperty("background");
                c.style.removeProperty("border-color");
                c.style.removeProperty("color");
            });
        }
        const chip = (typeof target === "string") ? document.getElementById(target) : target;
        if (chip) chip.classList.add("active");
        state.selectedVibe = vibeVal;
        saveSessionState();
    };

    window.selectBioStyle = function (target, styleVal) {
        const container = document.getElementById("bioStyleContainer");
        if (container) {
            const chips = container.querySelectorAll(".bio-style-chip");
            chips.forEach(function (c) {
                c.classList.remove("active");
                c.style.removeProperty("background");
                c.style.removeProperty("border-color");
                c.style.removeProperty("color");
            });
        }
        const chip = (typeof target === "string") ? document.getElementById(target) : target;
        if (chip) chip.classList.add("active");
        state.selectedBioStyle = styleVal;
        state.activeStyle = styleVal;
        saveSessionState();
    };

    // ============================================================
    // AUTHENTICATION GATES
    // ============================================================
    window.handleAuthBtnClick = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const isAuth = safeStorage.get("wingman_authenticated") === "true" || safeStorage.get("wingman_user_authenticated") === "true" || (typeof window.currentSupabaseUser === 'object' && window.currentSupabaseUser);
        if (isAuth) {
            if (typeof window.logoutUser === 'function') window.logoutUser(e);
            else {
                sessionStorage.clear();
                localStorage.clear();
                window.location.href = "index.html";
            }
        } else {
            if (typeof window.openAuthRequiredModal === 'function') window.openAuthRequiredModal(e);
        }
    };

    window.openAuthRequiredModal = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof window.closeInterstitialModal === 'function') window.closeInterstitialModal();
        const m = $("authRequiredModal"), c = $("authRequiredCard");
        if (m) {
            m.style.display = "flex";
            m.classList.remove("opacity-0", "pointer-events-none", "hidden");
            m.classList.add("opacity-100", "pointer-events-auto");
        }
        if (c) {
            c.classList.remove("scale-95");
            c.classList.add("scale-100");
        }
    };

    window.closeAuthRequiredModal = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const m = $("authRequiredModal"), c = $("authRequiredCard");
        if (c) {
            c.classList.remove("scale-100");
            c.classList.add("scale-95");
        }
        if (m) {
            m.classList.remove("opacity-100", "pointer-events-auto");
            m.classList.add("opacity-0", "pointer-events-none", "hidden");
            m.style.display = "none";
        }
        if (typeof window.updateTermsLockState === "function") window.updateTermsLockState();
    };

    window.isSignupMode = false;

    window.toggleAuthMode = function () {
        window.isSignupMode = !window.isSignupMode;
        const submitBtn = $("authSubmitBtn");
        const toggleBtn = $("authToggleModeBtn");
        const title = $("authModalTitle");
        const desc = $("authModalDesc");
        const errBox = $("authErrorMessage");
        const forgotBtn = $("forgotPasswordBtn");

        if (errBox) errBox.classList.add("hidden");
        window.hideForgotPasswordView();

        if (window.isSignupMode) {
            if (title) title.textContent = "Create an Account";
            if (desc) desc.textContent = "Sign up to save your preferences and manage credit balance.";
            if (submitBtn) submitBtn.textContent = "Sign Up with Email";
            if (toggleBtn) toggleBtn.textContent = "Already have an account? Sign In";
            if (forgotBtn) forgotBtn.classList.add("hidden");
        } else {
            if (title) title.textContent = "Sign In to MyWingman";
            if (desc) desc.textContent = "Sync your credit wallet balance and secure your workspace sessions.";
            if (submitBtn) submitBtn.textContent = "Sign In with Email";
            if (toggleBtn) toggleBtn.textContent = "Need an account? Sign Up";
            if (forgotBtn) forgotBtn.classList.remove("hidden");
        }
    };

    window.togglePasswordVisibility = function () {
        const pwInput = $("authPasswordInput");
        const toggleBtn = $("togglePasswordBtn");
        if (!pwInput || !toggleBtn) return;

        const iconEl = toggleBtn.querySelector(".material-symbols-outlined");
        if (pwInput.type === "password") {
            pwInput.type = "text";
            if (iconEl) iconEl.textContent = "visibility";
        } else {
            pwInput.type = "password";
            if (iconEl) iconEl.textContent = "visibility_off";
        }
    };

    window.showForgotPasswordView = function () {
        const form = $("supabaseAuthForm");
        const forgotView = $("forgotPasswordView");
        const toggleContainer = $("authToggleContainer");
        const title = $("authModalTitle");
        const desc = $("authModalDesc");
        const errBox = $("authErrorMessage");
        const resetErr = $("resetErrorMessage");
        const resetSuccess = $("resetSuccessMessage");

        if (form) form.classList.add("hidden");
        if (forgotView) forgotView.classList.remove("hidden");
        if (toggleContainer) toggleContainer.classList.add("hidden");
        if (title) title.textContent = "Reset Your Password";
        if (desc) desc.textContent = "Enter your email and we'll send you a secure password reset link.";
        if (errBox) errBox.classList.add("hidden");
        if (resetErr) resetErr.classList.add("hidden");
        if (resetSuccess) resetSuccess.classList.add("hidden");

        const emailInput = $("authEmailInput");
        const resetEmailInput = $("resetEmailInput");
        if (emailInput && resetEmailInput && emailInput.value) {
            resetEmailInput.value = emailInput.value;
        }
    };

    window.hideForgotPasswordView = function () {
        const form = $("supabaseAuthForm");
        const forgotView = $("forgotPasswordView");
        const toggleContainer = $("authToggleContainer");
        const title = $("authModalTitle");
        const desc = $("authModalDesc");

        if (form) form.classList.remove("hidden");
        if (forgotView) forgotView.classList.add("hidden");
        if (toggleContainer) toggleContainer.classList.remove("hidden");

        if (window.isSignupMode) {
            if (title) title.textContent = "Create an Account";
            if (desc) desc.textContent = "Sign up to save your preferences and manage credit balance.";
        } else {
            if (title) title.textContent = "Sign In to MyWingman";
            if (desc) desc.textContent = "Sync your credit wallet balance and secure your workspace sessions.";
        }
    };

    window.handleResetPassword = async function () {
        const resetEmailInput = $("resetEmailInput");
        const resetErr = $("resetErrorMessage");
        const resetSuccess = $("resetSuccessMessage");
        const resetBtn = $("resetPasswordSubmitBtn");
        const email = (resetEmailInput && resetEmailInput.value) ? resetEmailInput.value.trim() : "";

        if (resetErr) resetErr.classList.add("hidden");
        if (resetSuccess) resetSuccess.classList.add("hidden");

        if (!email || !email.includes("@") || !email.includes(".")) {
            if (resetErr) {
                resetErr.textContent = "Please enter a valid email address.";
                resetErr.classList.remove("hidden");
            }
            return;
        }

        if (window._resetPasswordCooldownTimer) return;

        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.textContent = "Sending...";
            resetBtn.classList.add("opacity-60", "cursor-not-allowed");
        }

        let isSuccess = false;
        try {
            if (typeof window.resetPasswordForEmail === "function") {
                const result = await window.resetPasswordForEmail(email);
                if (result && result.success) {
                    isSuccess = true;
                    if (resetSuccess) {
                        resetSuccess.textContent = "Password reset email sent! Check your inbox (and spam folder).";
                        resetSuccess.classList.remove("hidden");
                    }
                    if (typeof window.showToast === "function") {
                        window.showToast("Reset link sent to " + email + " 📧", "success");
                    }
                } else {
                    if (resetErr) {
                        resetErr.textContent = (result && result.error) || "Failed to send reset email. Try again.";
                        resetErr.classList.remove("hidden");
                    }
                }
            } else {
                if (resetErr) {
                    resetErr.textContent = "Password reset service is initializing. Please try again.";
                    resetErr.classList.remove("hidden");
                }
            }
        } catch (err) {
            if (resetErr) {
                resetErr.textContent = err.message || "An error occurred. Please try again.";
                resetErr.classList.remove("hidden");
            }
        } finally {
            if (isSuccess && resetBtn) {
                let countdown = 30;
                resetBtn.disabled = true;
                resetBtn.classList.add("opacity-60", "cursor-not-allowed");
                resetBtn.textContent = "Resend link in " + countdown + "s";

                if (window._resetPasswordInterval) clearInterval(window._resetPasswordInterval);
                window._resetPasswordCooldownTimer = true;

                window._resetPasswordInterval = setInterval(function () {
                    countdown--;
                    if (countdown > 0) {
                        if (resetBtn) resetBtn.textContent = "Resend link in " + countdown + "s";
                    } else {
                        clearInterval(window._resetPasswordInterval);
                        window._resetPasswordInterval = null;
                        window._resetPasswordCooldownTimer = false;
                        if (resetBtn) {
                            resetBtn.disabled = false;
                            resetBtn.classList.remove("opacity-60", "cursor-not-allowed");
                            resetBtn.textContent = "Resend Reset Link";
                        }
                    }
                }, 1000);
            } else if (resetBtn && !window._resetPasswordCooldownTimer) {
                resetBtn.disabled = false;
                resetBtn.classList.remove("opacity-60", "cursor-not-allowed");
                resetBtn.textContent = "Send Reset Link";
            }
        }
    };

    window.handleSupabaseAuthSubmit = async function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const emailInput = $("authEmailInput");
        const passwordInput = $("authPasswordInput");
        const email = (emailInput && emailInput.value) ? emailInput.value.trim() : "";
        const password = (passwordInput && passwordInput.value) ? passwordInput.value : "";
        const errBox = $("authErrorMessage");

        if (errBox) errBox.classList.add("hidden");

        if (!email || !email.includes("@") || !email.includes(".")) {
            if (errBox) {
                errBox.textContent = "Please enter a valid email address (e.g. name@domain.com).";
                errBox.classList.remove("hidden");
            }
            if (emailInput) emailInput.focus();
            return;
        }

        const websiteHpInput = $("website_hp");
        const websiteHp = (websiteHpInput && websiteHpInput.value) ? websiteHpInput.value.trim() : "";
        if (websiteHp.length > 0) {
            if (errBox) {
                errBox.textContent = "Bot detection triggered. Access denied.";
                errBox.classList.remove("hidden");
            }
            return;
        }

        if (!password || password.length < 8) {
            if (errBox) {
                errBox.textContent = "Password must be at least 8 characters long.";
                errBox.classList.remove("hidden");
            }
            if (passwordInput) passwordInput.focus();
            return;
        }

        let authResult = { success: false, error: 'Authentication service unavailable.' };

        if (typeof window.signUpUser === 'function' && window.isSignupMode) {
            authResult = await window.signUpUser(email, password);
        } else if (typeof window.loginUser === 'function') {
            authResult = await window.loginUser(email, password);
        }

        if (!authResult.success) {
            if (errBox) {
                errBox.textContent = authResult.error || "Authentication failed. Please check your credentials.";
                errBox.classList.remove("hidden");
            }
            return;
        }

        safeStorage.set("wingman_authenticated", "true");
        safeStorage.set("wingman_login_agreed", "true");
        safeStorage.set("wingman_user_authenticated", "true");
        safeStorage.set("wingman_user_email", email);

        if (typeof window.closeAuthRequiredModal === "function") window.closeAuthRequiredModal();
        if (typeof window.checkDashboardAuth === "function") window.checkDashboardAuth();
        if (typeof window.checkCreditBalance === "function") window.checkCreditBalance();
        if (typeof window.checkServerConsentStatus === "function") window.checkServerConsentStatus();
        if (typeof window.showToast === "function") {
            const actionText = window.isSignupMode ? "Account created as " : "Signed in as ";
            window.showToast(actionText + email + " 🚀", "success");
        }

        if (window.pendingPurchaseTargetUrl) {
            const targetUrl = window.pendingPurchaseTargetUrl;
            window.pendingPurchaseTargetUrl = null;
            window.location.href = targetUrl;
        }
    };

    window.handleDashboardGoogleSignIn = function (e) {
        if (e) e.preventDefault();
        window.signInWithGoogle();
    };

    window.handlePricingGoogleSignIn = function (e) {
        if (e) e.preventDefault();
        window.signInWithGoogle();
    };

    window.clearAppState = function () {
        window.currentSupabaseUser = null;
        window.currentSupabaseSession = null;

        state.uploadedFiles = [];
        state.croppedWebpDataUrl = null;
        state.lastResults = null;
        state.credits = null;
        state.creditsStatus = "idle";

        const desk = $("desktopCreditCount");
        if (desk) desk.textContent = "Credits —";
        const mob = $("mobileCreditCount");
        if (mob) mob.textContent = "Credits —";

        const analyzeCards = $("analyzeResultsCards");
        if (analyzeCards) analyzeCards.innerHTML = "";
        const icebreakCards = $("icebreakResultsCards");
        if (icebreakCards) icebreakCards.innerHTML = "";
        const optimizeCards = $("optimizeResultsCards");
        if (optimizeCards) optimizeCards.innerHTML = "";

        const bioInput = $("bioInput");
        if (bioInput) bioInput.value = "";
        const chatBox = $("chatMessagesContainer");
        if (chatBox) chatBox.innerHTML = "";

        try { sessionStorage.clear(); } catch(e){}
        try { localStorage.clear(); } catch(e){}
    };

    window.handleSignOut = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        window.clearAppState();
        if (typeof window.logoutUser === 'function') window.logoutUser(e);
        else window.location.href = "index.html";
    };

    window.checkDashboardAuth = function () {
        const isAuth = safeStorage.get("wingman_authenticated") === "true" || safeStorage.get("wingman_user_authenticated") === "true" || (typeof window.currentSupabaseUser === 'object' && window.currentSupabaseUser);
        const userEmail = safeStorage.get("wingman_user_email") || (window.currentSupabaseUser && window.currentSupabaseUser.email) || "";
        const avatarLetter = userEmail ? userEmail.charAt(0).toUpperCase() : "U";

        const userCard = $("sidebarUserCard");
        const desktopBtn = $("desktopAuthBtn");
        const emailBadge = $("userEmailBadge");
        const avatarBadge = $("userAvatarBadge");

        if (emailBadge && userEmail) emailBadge.textContent = userEmail;
        if (avatarBadge) avatarBadge.textContent = avatarLetter;

        if (isAuth) {
            if (userCard) userCard.classList.remove("hidden");
            if (desktopBtn) desktopBtn.classList.add("hidden");
        } else {
            if (userCard) userCard.classList.add("hidden");
            if (desktopBtn) desktopBtn.classList.remove("hidden");
        }

        const mobileLabel = $("mobileAuthBtnLabel");
        const mobileBtn = $("mobileAuthBtn");
        if (mobileLabel && isAuth) mobileLabel.textContent = "Sign Out";
        else if (mobileLabel) mobileLabel.textContent = "Sign In";

        if (mobileBtn && isAuth) {
            mobileBtn.onclick = function (e) { window.handleSignOut(e); };
        } else if (mobileBtn) {
            mobileBtn.onclick = function (e) {
                if (typeof window.openAuthRequiredModal === 'function') window.openAuthRequiredModal(e);
            };
        }

        const b = $("topAuthBanner");
        if (b) {
            if (isAuth) b.classList.add("hidden");
            else b.classList.remove("hidden");
        }

        if (state.showPlexus !== false) {
            if (typeof window.startPlexusAnimation === 'function') window.startPlexusAnimation();
        } else {
            if (typeof window.stopPlexusAnimation === 'function') window.stopPlexusAnimation();
        }
    };

    // ============================================================
    // PURCHASE MODAL – Server‑only credit updates
    // ============================================================
    window.openPurchaseModal = function () {
        const m = $("purchaseModal"), c = $("modalCard"), pt = $("pricingTiers");
        if (!m || !c) return;
        document.body.style.overflow = "hidden";
        m.style.display = "flex";
        m.classList.remove("opacity-0", "pointer-events-none", "hidden");
        m.classList.add("opacity-100", "pointer-events-auto");
        c.classList.remove("scale-95");
        c.classList.add("scale-100");
        if (pt) pt.scrollTop = 0;

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const tierParam = urlParams.get("tier");
            if (tierParam) {
                const targetRadio = document.querySelector("input[name='pricing_tier'][value='" + tierParam + "']");
                if (targetRadio && targetRadio.closest(".pricing-tier-card")) {
                    window.selectPricingCard(targetRadio.closest(".pricing-tier-card"));
                    return;
                }
            }
        } catch (err) {}

        const checkedRadio = document.querySelector("input[name='pricing_tier']:checked");
        if (checkedRadio && checkedRadio.closest(".pricing-tier-card")) {
            window.selectPricingCard(checkedRadio.closest(".pricing-tier-card"));
        }
    };

    window.closePurchaseModal = function (e) {
        if (e) e.preventDefault();
        const m = $("purchaseModal"), c = $("modalCard");
        if (!m || !c) return;
        document.body.style.overflow = "";
        c.classList.remove("scale-100");
        c.classList.add("scale-95");
        m.classList.remove("opacity-100", "pointer-events-auto");
        m.classList.add("opacity-0", "pointer-events-none", "hidden");
        m.style.display = "none";
    };

    window.selectPricingCard = function (labelEl) {
        if (!labelEl) return;
        const radio = labelEl.querySelector("input[name='pricing_tier']");
        if (!radio) return;
        radio.checked = true;

        const price = Number(radio.getAttribute("data-price")) || 19.99;
        const credits = Number(radio.getAttribute("data-credits")) || 3000;
        const tierValue = radio.value;

        state.selectedTier = {
            value: tierValue,
            credits: credits,
            price: price
        };

        document.querySelectorAll(".pricing-tier-card").forEach(function (card) {
            card.classList.remove("active-tier");
        });
        labelEl.classList.add("active-tier");

        const btnTextEl = $("purchaseBtnText");
        if (btnTextEl) {
            const label = tierValue === 'starter' ? 'Starter Bundle' : (tierValue === 'pro' ? 'Pro Bundle' : 'Elite Bundle');
            btnTextEl.textContent = "Acquire " + label + " - $" + price.toFixed(2);
        }
    };

    // PURCHASE HANDLER WITH STRICT AUTH & SERVER TRUTH
    window.simulateDemoPurchase = async function (creditAmount, btnEl) {
        if (typeof window.showToast === 'function') {
            window.showToast("Credit purchasing is currently unavailable while payment gateway upgrades are underway. Please enjoy your free starting credits!", "warning");
        }
    };

    window.confirmPurchase = async function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof window.showToast === 'function') {
            window.showToast("Credit purchasing is currently unavailable while payment gateway upgrades are underway. Please enjoy your free starting credits!", "warning");
        }
    };

    // ============================================================
    // SETTINGS MODAL
    // ============================================================
    window.openSettingsModal = function (e) {
        if (e) e.preventDefault();

        const shorthandInput = $("settingLinguisticShorthand");
        if (shorthandInput) shorthandInput.checked = state.shorthandOption !== false;

        const emojiInput = $("settingEmojiDensity");
        if (emojiInput) {
            emojiInput.value = state.emojiOption !== undefined ? state.emojiOption : 1;
            updateEmojiLabel(emojiInput.value);
        }

        const plexusInput = $("settingPlexusToggle");
        if (plexusInput) plexusInput.checked = state.showPlexus !== false;

        const m = $("settingsModal"), c = $("settingsCard");
        if (m) {
            m.style.display = "flex";
            m.classList.remove("opacity-0", "pointer-events-none", "hidden");
            m.classList.add("opacity-100", "pointer-events-auto");
        }
        if (c) {
            c.classList.remove("scale-95");
            c.classList.add("scale-100");
        }
    };

    window.closeSettingsModal = function (e) {
        if (e) e.preventDefault();
        const m = $("settingsModal"), c = $("settingsCard");
        if (c) {
            c.classList.remove("scale-100");
            c.classList.add("scale-95");
        }
        if (m) {
            m.classList.remove("opacity-100", "pointer-events-auto");
            m.classList.add("opacity-0", "pointer-events-none", "hidden");
            m.style.display = "none";
        }
    };

    window.openDeleteFromSettings = function (e) {
        if (e) e.preventDefault();
        window.closeSettingsModal(e);
        setTimeout(function() {
            window.openDeleteAccountModal(e);
        }, 300);
    };

    function updateEmojiLabel(val) {
        const label = $("emojiLevelLabel");
        if (!label) return;
        const intVal = parseInt(val);
        if (intVal === 0) label.textContent = "Zero Emojis";
        else if (intVal === 1) label.textContent = "Minimal (End only)";
        else if (intVal === 2) label.textContent = "Expressive";
    }

    function initSettingsListeners() {
        const shorthandInput = $("settingLinguisticShorthand");
        if (shorthandInput) {
            shorthandInput.checked = state.shorthandOption !== false;
            shorthandInput.addEventListener("change", function(e) {
                state.shorthandOption = e.target.checked;
                safeStorage.set("wingman_setting_shorthand", e.target.checked ? "true" : "false");
            });
        }

        const emojiInput = $("settingEmojiDensity");
        if (emojiInput) {
            emojiInput.value = state.emojiOption !== undefined ? state.emojiOption : 1;
            updateEmojiLabel(emojiInput.value);
            emojiInput.addEventListener("input", function(e) {
                updateEmojiLabel(e.target.value);
                state.emojiOption = parseInt(e.target.value);
                safeStorage.set("wingman_setting_emoji", e.target.value);
            });
        }

        const plexusInput = $("settingPlexusToggle");
        if (plexusInput) {
            plexusInput.checked = state.showPlexus !== false;
            plexusInput.addEventListener("change", function(e) {
                state.showPlexus = e.target.checked;
                safeStorage.set("wingman_setting_plexus", e.target.checked ? "true" : "false");
                if (state.showPlexus) {
                    if (typeof window.startPlexusAnimation === "function") window.startPlexusAnimation();
                } else {
                    if (typeof window.stopPlexusAnimation === "function") window.stopPlexusAnimation();
                }
            });
        }
    }

    // ============================================================
    // STAR PLEXUS CANVAS ANIMATION SYSTEM (HIGH-DPI & HIGH-CONTRAST)
    // ============================================================
    function initAmbientPlexusCanvas() {
        // The animated high-DPI plexus is decorative and disproportionately expensive on phones.
        if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
            const mobileCanvas = document.getElementById("ambient-plexus-canvas");
            if (mobileCanvas) mobileCanvas.style.display = 'none';
            return;
        }
        const canvas = document.getElementById("ambient-plexus-canvas");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");

        let dpr = Math.max(1, window.devicePixelRatio || 1);
        let cssWidth = window.innerWidth || document.documentElement.clientWidth;
        let cssHeight = window.innerHeight || document.documentElement.clientHeight;

        function resizeCanvas() {
            dpr = Math.max(1, window.devicePixelRatio || 1);
            cssWidth = window.innerWidth || document.documentElement.clientWidth;
            cssHeight = window.innerHeight || document.documentElement.clientHeight;

            canvas.width = Math.floor(cssWidth * dpr);
            canvas.height = Math.floor(cssHeight * dpr);
            canvas.style.width = cssWidth + "px";
            canvas.style.height = cssHeight + "px";

            for (let i = 0; i < numParticles; i++) {
                const p = particles[i];
                if (p) {
                    if (p.x > cssWidth) p.x = Math.random() * cssWidth;
                    if (p.y > cssHeight) p.y = Math.random() * cssHeight;
                }
            }
        }

        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', resizeCanvas);

        const isMobile = window.innerWidth < 768;
        const numParticles = Math.min(65, Math.max(isMobile ? 32 : 20, Math.floor((cssWidth * cssHeight) / (isMobile ? 9000 : 18000))));
        const particles = [];

        for (let i = 0; i < numParticles; i++) {
            particles.push({
                x: Math.random() * cssWidth,
                y: Math.random() * cssHeight,
                vx: (Math.random() - 0.5) * (isMobile ? 0.6 : 0.45),
                vy: (Math.random() - 0.5) * (isMobile ? 0.6 : 0.45),
                radius: Math.random() * (isMobile ? 2.8 : 2.4) + (isMobile ? 1.8 : 1.5)
            });
        }

        resizeCanvas();

        let mouse = { x: null, y: null, radius: 170 };
        window.addEventListener("mousemove", function (e) {
            if (e.target.closest('#pricing') || e.target.closest('#pricingTiers') || e.target.closest('.pricing-tier-card') || e.target.closest('.glass-card')) {
                mouse.x = null;
                mouse.y = null;
                return;
            }
            const rect = canvas.getBoundingClientRect();
            mouse.x = e.clientX - rect.left;
            mouse.y = e.clientY - rect.top;
        });
        window.addEventListener("mouseleave", function () {
            mouse.x = null;
            mouse.y = null;
        });

        let animId = null;

        function animate() {
            if (state.showPlexus === false) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                canvas.style.display = 'none';
                animId = null;
                return;
            }

            canvas.style.display = 'block';
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.save();
            ctx.scale(dpr, dpr);

            ctx.shadowBlur = 0;

            for (let i = 0; i < numParticles; i++) {
                const p = particles[i];

                p.x += p.vx;
                p.y += p.vy;

                if (p.x < 0) { p.x = 0; p.vx *= -1; }
                else if (p.x > cssWidth) { p.x = cssWidth; p.vx *= -1; }
                if (p.y < 0) { p.y = 0; p.vy *= -1; }
                else if (p.y > cssHeight) { p.y = cssHeight; p.vy *= -1; }

                if (mouse.x !== null && mouse.y !== null) {
                    const dx = mouse.x - p.x;
                    const dy = mouse.y - p.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist < mouse.radius) {
                        const force = (mouse.radius - dist) / mouse.radius;
                        p.x += (dx / dist) * force * 0.7;
                        p.y += (dy / dist) * force * 0.7;
                    }
                }

                // Node bright neon glow
                ctx.shadowBlur = 18;
                ctx.shadowColor = '#d946ef';

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(217, 70, 239, 0.95)";
                ctx.fill();
                ctx.closePath();

                // Core highlight center dot
                ctx.shadowBlur = 0;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius * 0.5, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
                ctx.fill();
                ctx.closePath();

                for (let j = i + 1; j < numParticles; j++) {
                    const p2 = particles[j];
                    const dx = p.x - p2.x;
                    const dy = p.y - p2.y;
                    const dist = Math.hypot(dx, dy);
                    const maxDist = isMobile ? 110 : 135;
                    if (dist < maxDist) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p2.x, p2.y);
                        const alpha = (maxDist - dist) / maxDist;
                        ctx.strokeStyle = `rgba(192, 132, 252, ${alpha * 0.85})`;
                        ctx.lineWidth = 1.35;
                        ctx.stroke();
                        ctx.closePath();
                    }
                }
            }

            ctx.restore();
            animId = requestAnimationFrame(animate);
        }

        window.startPlexusAnimation = function () {
            if (!animId && state.showPlexus !== false) {
                canvas.style.display = 'block';
                animId = requestAnimationFrame(animate);
            }
        };

        window.stopPlexusAnimation = function () {
            if (animId) {
                cancelAnimationFrame(animId);
                animId = null;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.style.display = 'none';
        };

        if (state.showPlexus !== false) {
            window.startPlexusAnimation();
        } else {
            canvas.style.display = 'none';
        }
    }

    function initFormInputListeners() {
        initSettingsListeners();
        initAmbientPlexusCanvas();

        const bi = $("bioInput");
        if (bi) {
            bi.addEventListener("input", function() { window.updateButtonStates(); });
            bi.addEventListener("keyup", function() { window.updateButtonStates(); });
            bi.addEventListener("paste", function() { setTimeout(window.updateButtonStates, 50); });
        }

        const ai = $("auditBioInput");
        if (ai) {
            ai.addEventListener("input", function() { window.updateButtonStates(); });
            ai.addEventListener("keyup", function() { window.updateButtonStates(); });
            ai.addEventListener("paste", function() { setTimeout(window.updateButtonStates, 50); });
        }

        const ci = $("simulator-chat-input");
        if (ci) {
            ci.addEventListener("input", function() { window.updateButtonStates(); });
            ci.addEventListener("keyup", function() { window.updateButtonStates(); });
            ci.addEventListener("paste", function() { setTimeout(window.updateButtonStates, 50); });
        }

        const si = $("screenshotInput");
        if (si && !si._changeListenerAttached) {
            si._changeListenerAttached = true;
            si.addEventListener("change", function(e) {
                if (e.target.files && e.target.files.length > 0) {
                    window.processSelectedFiles(e.target.files);
                }
            });
        }

        const dz = $("dropzone");
        if (dz && !dz._dragListenersAttached) {
            dz._dragListenersAttached = true;
            dz.addEventListener("dragover", function(e) {
                e.preventDefault();
                e.stopPropagation();
                dz.classList.add("border-violet-500");
            });
            dz.addEventListener("dragleave", function(e) {
                e.preventDefault();
                e.stopPropagation();
                dz.classList.remove("border-violet-500");
            });
            dz.addEventListener("drop", function(e) {
                e.preventDefault();
                e.stopPropagation();
                dz.classList.remove("border-violet-500");
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    window.processSelectedFiles(e.dataTransfer.files);
                }
            });
        }

        const container = $("chatbox-messages-container");
        if (container && container.querySelectorAll(".animate-chat-bubble").length === 0) {
            if (typeof window.clearAndResetChatbox === "function") {
                window.clearAndResetChatbox();
            }
        }

        window.updateTermsLockState();
        window.updateButtonStates();
        if (typeof window.checkServerConsentStatus === "function") {
            window.checkServerConsentStatus();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initFormInputListeners);
    } else {
        initFormInputListeners();
    }

    window.togglePlexusPerformance = function () {
        const plexusInput = $("settingPlexusToggle");
        if (plexusInput) {
            state.showPlexus = plexusInput.checked;
            safeStorage.set("wingman_setting_plexus", plexusInput.checked ? "true" : "false");
            if (state.showPlexus) {
                if (typeof window.startPlexusAnimation === "function") window.startPlexusAnimation();
            } else {
                if (typeof window.stopPlexusAnimation === "function") window.stopPlexusAnimation();
            }
        }
    };

    // ============================================================
    // ACCOUNT DELETION
    // ============================================================
    window.openDeleteAccountModal = function (e) {
        if (e) e.preventDefault();
        const m = $("deleteAccountModal"), c = $("deleteAccountCard");
        if (m) {
            m.style.display = "flex";
            m.classList.remove("opacity-0", "pointer-events-none", "hidden");
            m.classList.add("opacity-100", "pointer-events-auto");
        }
        if (c) {
            c.classList.remove("scale-95");
            c.classList.add("scale-100");
        }
    };

    window.closeDeleteAccountModal = function (e) {
        if (e) e.preventDefault();
        const m = $("deleteAccountModal"), c = $("deleteAccountCard");
        if (c) {
            c.classList.remove("scale-100");
            c.classList.add("scale-95");
        }
        if (m) {
            m.classList.remove("opacity-100", "pointer-events-auto");
            m.classList.add("opacity-0", "pointer-events-none", "hidden");
            m.style.display = "none";
        }
    };

    window.confirmPermanentDeletion = async function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const btn = $("confirmDeleteAccountBtn");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-[16px]">progress_activity</span><span>Purging Database...</span>';
        }

        try {
            const apiBase = getApiBase();
            const headers = { 'Content-Type': 'application/json' };
            const token = window.getSupabaseAccessToken ? window.getSupabaseAccessToken() : null;
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }

            const response = await fetch(apiBase + '/api/user/delete-account', {
                method: 'POST',
                headers: headers,
                credentials: 'include'
            });

            const data = await response.json().catch(function () { return {}; });

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Account deletion failed on server.');
            }

            try { safeStorage.clear(); } catch (err) {}
            if (window.supabase) {
                try { await window.supabase.auth.signOut(); } catch (sErr) {}
            }
            window.closeDeleteAccountModal();
            window.showToast("Account profile & data permanently purged.", "warning");
            setTimeout(function () { window.location.href = "index.html"; }, 800);
        } catch (err) {
            console.error('[Delete Account Error]:', err);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete_forever</span><span>Delete Permanently</span>';
            }
            window.showToast(err.message || "Failed to delete account. Please try again.", "error");
        }
    };

    // ============================================================
    // TOAST NOTIFICATIONS
    // ============================================================
    window.showToast = function (msg, type, append) {
        try {
            let container = $("toastContainer");
            if (!container) {
                container = document.createElement("div");
                container.id = "toastContainer";
                container.className = "fixed top-5 right-5 z-[200] flex flex-col gap-3 pointer-events-none max-w-sm w-full px-4 sm:px-0";
                document.body.appendChild(container);
            }

            if (!append) container.innerHTML = "";

            const toast = document.createElement("div");
            let cls = type === "success" ? "bg-[#062419] border-emerald-500/60 text-emerald-200"
                : type === "warning" ? "bg-[#291b05] border-amber-500/60 text-amber-200"
                : type === "error" ? "bg-[#290910] border-rose-500/60 text-rose-200"
                : type === "shield" ? "bg-[#062419] border-emerald-500/60 text-emerald-300"
                : "bg-[#131124] border-violet-500/50 text-white";

            const icon = type === "success" ? "check_circle" : type === "warning" ? "warning" : type === "error" ? "error" : type === "shield" ? "verified_user" : "info";
            toast.className = "toast-enter flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-xs font-medium max-w-[340px] pointer-events-auto transition-all cursor-pointer " + cls;

            if (type === "shield") {
                toast.style.cssText = "border: 1px solid rgba(34, 197, 94, 0.6) !important; background: #062419 !important; opacity: 1 !important; color: #a7f3d0 !important;";
            }

            if (msg && typeof msg === "object") {
                toast.innerHTML = '<span class="material-symbols-outlined text-[18px] shrink-0 mt-0.5">' + icon + '</span>' +
                                  '<div class="flex flex-col gap-1 text-left">' +
                                  '<span class="font-bold text-[13px] leading-tight">' + esc(msg.title) + '</span>' +
                                  '<span class="leading-normal text-slate-300 text-[11px]">' + esc(msg.subtext) + '</span>' +
                                  '</div>';
            } else {
                toast.innerHTML = '<span class="material-symbols-outlined text-[18px] shrink-0">' + icon + '</span><span class="leading-snug">' + esc(msg) + '</span>';
            }

            toast.onclick = function() {
                try { toast.remove(); } catch (e) {}
            };

            container.appendChild(toast);
            setTimeout(function () {
                try {
                    toast.classList.remove("toast-enter");
                    toast.classList.add("toast-exit");
                    setTimeout(function () { try { toast.remove(); } catch (e) {} }, 300);
                } catch (e) {}
            }, 5000);
        } catch (e) {}
    };

    window.showNotification = function (title, subtext, type) {
        window.showToast({ title: title, subtext: subtext }, type);
    };

    // ============================================================
    // SESSION PERSISTENCE (includes chat thread)
    // ============================================================
    function saveSessionState() {
        try {
            const bioVal = $("bioInput") ? $("bioInput").value : "";
            const auditVal = $("auditBioInput") ? $("auditBioInput").value : "";
            const iceRes = $("icebreakResultsState");
            const optRes = $("optimizer-results-container") ? $("optimizeResultsState") : null;

            // Retain uploaded screenshots in-memory only to prevent localStorage quota exhaustion
            const payload = {
                lifecycle: state.lifecycle || "EMPTY",
                activeTab: state.activeTab || "analyzeSection",
                activeTone: state.activeTone || "Witty",
                bioInput: bioVal,
                icebreakCardsData: state.icebreakCardsData || null,
                icebreakVisible: iceRes ? !iceRes.classList.contains("hidden") : false,
                auditInput: auditVal,
                optimizeCardsData: state.optimizeCardsData || null,
                optimizeVisible: optRes ? !optRes.classList.contains("hidden") : false,
                activeTranscriptCache: state.activeTranscriptCache || null,
                selectedBioStyle: state.selectedBioStyle || "Punchy",
                selectedVibe: state.selectedVibe || "Direct",
                activeSimulatorThread: activeSimulatorThread || []
            };

            safeStorage.set(SESSION_KEY, JSON.stringify(payload));
        } catch (e) {}
    }

    function restoreSessionState() {
        try {
            const raw = safeStorage.get(SESSION_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!data) return;

            // Security & Storage hygiene: ignore and purge any legacy persisted screenshot base64 strings or HTML strings
            if (data.uploadedFiles || data.icebreakHtml || data.optimizeHtml) {
                delete data.uploadedFiles;
                delete data.icebreakHtml;
                delete data.optimizeHtml;
                try {
                    safeStorage.set(SESSION_KEY, JSON.stringify(data));
                } catch (e) {}
            }

            if (data.activeTranscriptCache) state.activeTranscriptCache = data.activeTranscriptCache;

            if (data.activeTone) {
                state.activeTone = data.activeTone;
                const valMap = { "Witty": "tone-witty", "witty": "tone-witty", "Flirty": "tone-flirty", "flirty": "tone-flirty", "Casual": "tone-casual", "casual": "tone-casual", "Bold": "tone-bold", "bold": "tone-bold", "Closer": "tone-bold", "closer": "tone-bold" };
                const targetId = valMap[data.activeTone];
                if (targetId) window.selectTone(targetId, data.activeTone);
            }

            if (data.selectedBioStyle) {
                state.selectedBioStyle = data.selectedBioStyle;
                const valMap = { "Punchy": "style-punchy", "punchy": "style-punchy", "Playful": "style-playful", "playful": "style-playful", "Green Flag": "style-greenflag", "greenflag": "style-greenflag", "Mysterious": "style-mysterious", "mysterious": "style-mysterious", "Hot Take": "style-punchy", "hottake": "style-punchy" };
                const targetId = valMap[data.selectedBioStyle];
                if (targetId) window.selectBioStyle(targetId, data.selectedBioStyle);
            }

            if (data.selectedVibe) {
                state.selectedVibe = data.selectedVibe;
                const valMap = { "Direct": "vibe-direct", "direct": "vibe-direct", "Intriguing": "vibe-intriguing", "intriguing": "vibe-intriguing", "Humorous": "vibe-humorous", "humorous": "vibe-humorous", "Compliment": "vibe-compliment", "compliment": "vibe-compliment", "Debate": "vibe-direct", "debate": "vibe-direct" };
                const targetId = valMap[data.selectedVibe];
                if (targetId) window.selectVibe(targetId, data.selectedVibe);
            }

            if (data.lifecycle && data.lifecycle !== "ANALYZING") {
                window.setLifecycleState(data.lifecycle);
            }

            if (data.activeTab) window.switchTab(data.activeTab);

            const bi = $("bioInput");
            if (bi && data.bioInput) bi.value = data.bioInput;
            if (data.icebreakVisible && data.icebreakCardsData) {
                state.icebreakCardsData = data.icebreakCardsData;
                const empI = $("icebreakEmptyState"), skelI = $("icebreakSkeletonState"), resI = $("icebreakResultsState");
                if (empI) empI.classList.add("hidden");
                if (skelI) skelI.classList.add("hidden");
                if (resI) {
                    resI.classList.remove("hidden");
                    window.renderFiveCards("icebreakResultsState", data.icebreakCardsData);
                }
            }

            const ai = $("auditBioInput");
            if (ai && data.auditInput) ai.value = data.auditInput;
            if (data.optimizeVisible && data.optimizeCardsData) {
                state.optimizeCardsData = data.optimizeCardsData;
                const empO = $("optimizeEmptyState"), skelO = $("optimizeSkeletonState"), resO = $("optimizeResultsState");
                if (empO) empO.classList.add("hidden");
                if (skelO) skelO.classList.add("hidden");
                if (resO) {
                    resO.classList.remove("hidden");
                    window.renderFiveCards("optimizeResultsState", data.optimizeCardsData);
                }
            }

            if (Array.isArray(data.activeSimulatorThread) && data.activeSimulatorThread.length > 0) {
                activeSimulatorThread = data.activeSimulatorThread;
                const chatContainer = $("chatbox-messages-container");
                if (chatContainer) {
                    chatContainer.innerHTML = "";
                    activeSimulatorThread.forEach(function (msg) {
                        if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
                            window.renderChatboxBubble(msg.content || msg.text, msg.role);
                        }
                    });
                }
            }
        } catch (e) {}
    }

    // ============================================================
    // URL TIER PARAMETER (activation modal)
    // ============================================================
    function handleUrlTierParameters() {
        try {
            const params = new URLSearchParams(window.location.search);
            const tier = params.get("tier");
            if (!tier) return;

            const isAuth = safeStorage.get("wingman_authenticated") === "true" || safeStorage.get("wingman_user_authenticated") === "true";
            if (!isAuth) {
                window.openAuthRequiredModal();
                return;
            }

            const creditMap = { starter: 250, pro: 600, elite: 3000 };
            const nameMap = { starter: "Starter Pack", pro: "Pro Pack", elite: "Elite Pack" };

            if (creditMap[tier]) {
                window.simulateDemoPurchase(creditMap[tier]).then(function() {
                    const badge = $("activationBadge");
                    const title = $("activationTitle");
                    const desc = $("activationDesc");

                    if (badge) badge.textContent = nameMap[tier] + " Activated";
                    if (title) title.textContent = creditMap[tier] + " Credits Added";
                    if (desc) desc.textContent = "Your " + creditMap[tier] + " credits are active! Upload your chat screenshots on the left to generate tailored replies.";

                    const am = $("activationModal"), ac = $("activationCard");
                    if (am && ac) {
                        am.classList.remove("opacity-0", "pointer-events-none");
                        am.classList.add("opacity-100", "pointer-events-auto");
                        ac.classList.remove("scale-95");
                        ac.classList.add("scale-100");
                    }
                });

                try {
                    window.history.replaceState({}, document.title, window.location.pathname);
                } catch (e2) {}
            }
        } catch (e) {}
    }

    window.closeActivationModal = function (e) {
        if (e) e.preventDefault();
        const am = $("activationModal"), ac = $("activationCard");
        if (!am || !ac) return;
        ac.classList.remove("scale-100");
        ac.classList.add("scale-95");
        am.classList.remove("opacity-100", "pointer-events-auto");
        am.classList.add("opacity-0", "pointer-events-none");
    };

    window.highlightTermsCheckbox = function () {
        try {
            const container = $("termsCheckboxContainer");
            if (!container) return;
            container.classList.remove("terms-shake-pulse");
            void container.offsetWidth;
            container.classList.add("terms-shake-pulse");
            setTimeout(function () {
                try { container.classList.remove("terms-shake-pulse"); } catch (e) {}
            }, 800);
        } catch (e) {}
    };

    window.fetchRealApiCredits = async function () {
        return await window.checkCreditBalance();
    };

    // ============================================================
    // API HELPER – handles 402 with credit sync
    // ============================================================
    window.generateWingmanResponse = async function (endpoint, payload) {
        const isAuth = await isUserAuthenticated();
        if (!isAuth) {
            if (typeof window.showToast === 'function') window.showToast("Authentication required to use AI features. Please sign in.", "warning");
            if (typeof window.openAuthRequiredModal === 'function') window.openAuthRequiredModal();
            return null;
        }

        const idempotencyKey = (payload && payload.idempotencyKey) || ('cli_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
        if (payload) payload.idempotencyKey = idempotencyKey;

        trackWingmanEvent('generation_started', { endpoint: endpoint });
        const maxRetries = 2;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                const apiBase = getApiBase();
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000);

                const userHeaderId = (window.currentSupabaseUser ? (window.currentSupabaseUser.id || window.currentSupabaseUser.email) : (safeStorage.get("wingman_user_email") || "guest_user"));
                const userHeaderEmail = (window.currentSupabaseUser ? window.currentSupabaseUser.email : (safeStorage.get("wingman_user_email") || ""));

                const authHeaders = (typeof window.getSupabaseAuthHeaders === 'function') ? await window.getSupabaseAuthHeaders() : {};
                const reqHeaders = {
                    'Content-Type': 'application/json',
                    'X-User-Id': userHeaderId,
                    'X-User-Email': userHeaderEmail,
                    'X-Idempotency-Key': idempotencyKey,
                    ...authHeaders
                };

                const response = await fetch(apiBase + endpoint, {
                    method: 'POST',
                    headers: reqHeaders,
                    credentials: 'include',
                    signal: controller.signal,
                    body: JSON.stringify(payload)
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errJson = await response.json().catch(function() { return {}; });

                    if (response.status === 401) {
                        // Authentication failure does NOT mean the user's real wallet balance is zero.
                        state.credits = null;
                        state.creditsStatus = "idle";
                        if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                        if (typeof window.showToast === 'function') window.showToast("Authentication required. Please sign in.", "warning");
                        if (typeof window.openAuthRequiredModal === 'function') window.openAuthRequiredModal();
                        return null;
                    }

                    if (response.status === 402) {
                        trackWingmanEvent('credits_exhausted', { endpoint: endpoint, currentCredits: state.credits || 0 });
                        const requiredCreditCost = (endpoint === '/api/chat' || endpoint === '/api/simulator/chat' || endpoint === '/api/simulator/review') ? 2 : 10;
                        const authoritativeBalanceCheck = await window.checkCreditBalance();
                        if (!authoritativeBalanceCheck || !authoritativeBalanceCheck.success || typeof state.credits !== 'number') {
                            if (typeof window.showToast === 'function') {
                                window.showToast("The server rejected this request for credits, but your current wallet balance could not be verified. Please refresh or sign in again.", "warning");
                            }
                            return null;
                        }
                        if (state.credits >= requiredCreditCost) {
                            if (typeof window.showToast === 'function') {
                                window.showToast("Your wallet has enough credits, but this request was rejected by the credit service. Please refresh or sign in again; no purchase is required.", "warning");
                            }
                            return null;
                        }
                        if (typeof window.showToast === 'function') {
                            window.showToast(errJson.error || ("Insufficient credits. Current balance: " + state.credits + " credits. Please top up."), "warning");
                        }
                        if (typeof window.openPurchaseModal === 'function') window.openPurchaseModal();
                        return null;
                    }

                    if (response.status === 403) {
                        if (errJson.code === "CONSENT_REQUIRED" || (errJson.error && errJson.error.toLowerCase().includes("consent"))) {
                            state.isTermsAccepted = false;
                            state.consentStatus = 'consent_required';
                            safeStorage.remove('wingman_terms_accepted');
                            safeStorage.remove('wingman_consent_version');
                            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                            if (typeof window.openInterstitialModal === 'function') window.openInterstitialModal();
                            if (typeof window.showToast === 'function') {
                                window.showToast("18+ verification and Terms of Service consent are required to process requests.", "warning");
                            }
                            return null;
                        }
                        if (typeof window.showToast === 'function') {
                            window.showToast(errJson.error || "Access forbidden. Please sign in or check your account permissions.", "warning");
                        }
                        return null;
                    }

                    if (response.status === 409) {
                        trackWingmanEvent('generation_duplicate', { endpoint: endpoint });
                        if (typeof window.checkCreditBalance === 'function') {
                            await window.checkCreditBalance();
                        }
                        if (typeof window.showToast === 'function') {
                            window.showToast(errJson.error || "This request ID has already been processed or is already in progress. No additional credits were deducted.", "info");
                        }
                        return null;
                    }

                    if (response.status === 429) {
                        if (typeof window.showToast === 'function') {
                            window.showToast("Too many requests. Please slow down and wait a moment.", "warning");
                        }
                        return null;
                    }

                    if (response.status === 503) {
                        trackWingmanEvent('generation_failed', { endpoint: endpoint, status: 503 });
                        if (errJson.code === "CONSENT_SERVICE_UNAVAILABLE") {
                            state.isTermsAccepted = false;
                            state.consentStatus = 'service_unavailable';
                            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                            if (typeof window.showToast === 'function') {
                                window.showToast(errJson.error || "Consent verification service is temporarily unavailable. Features remain locked.", "error");
                            }
                            return null;
                        }
                        if (typeof window.showToast === 'function') {
                            window.showToast(errJson.error || "Credit service is temporarily unavailable. Your generation was not started. Please try again later.", "warning");
                        }
                        return null;
                    }

                    if (typeof errJson.credits === "number") {
                        window.updateUICredits(errJson.credits);
                    }
                    trackWingmanEvent('generation_failed', { endpoint: endpoint, status: response.status });
                    const err = new Error(errJson.error || "Generation request failed. If you were charged credits, please contact support.mywingman@gmail.com.");
                    err.status = response.status;
                    err.credits = errJson.credits;
                    throw err;
                }

                const data = await response.json();
                if (typeof data.credits === "number") {
                    state.credits = data.credits;
                    syncCredits();
                }
                trackWingmanEvent('generation_succeeded', { endpoint: endpoint, remainingCredits: data.credits });
                return data.options || data.text || data.reply || (data.choices && data.choices[0] && (data.choices[0].message ? data.choices[0].message.content : data.choices[0].message)) || "";
            } catch (err) {
                attempt++;
                console.warn(`API attempt ${attempt} failed:`, err.message);
                if (attempt > maxRetries) {
                    trackWingmanEvent('generation_failed', { endpoint: endpoint, status: err.status || 500 });
                    if (typeof window.showToast === 'function') {
                        window.showToast("Generation status could not be confirmed. Refreshing your credit balance…", "warning");
                    }
                    if (typeof window.checkCreditBalance === 'function') {
                        window.checkCreditBalance();
                    }
                    return null;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return null;
    };

    // ============================================================
    // RENDER FIVE CARDS
    // ============================================================
    window.renderFiveCards = function (containerId, cardsData) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        let results = [];
        if (Array.isArray(cardsData)) {
            cardsData.forEach(function(opt) {
                let cleaned = typeof opt === "string" ? cleanSystemTags(opt) : (opt && opt.line ? cleanSystemTags(opt.line) : "");
                cleaned = cleaned.trim().replace(/^Option\s*\d+[\:\.\-]?\s*/i, "");
                if (cleaned && results.length < 10) results.push(cleaned);
            });
        } else if (typeof cardsData === 'string') {
            try {
                const parsedJson = JSON.parse(cardsData);
                if (parsedJson && Array.isArray(parsedJson.options)) {
                    parsedJson.options.forEach(function(opt) {
                        let cleaned = cleanSystemTags(opt).trim().replace(/^Option\s*\d+[\:\.\-]?\s*/i, "");
                        if (cleaned && results.length < 10) results.push(cleaned);
                    });
                }
            } catch(e) {}

            if (results.length === 0) {
                const numberSplits = cardsData.split(/(?:^|\n)\d+[\.\)\:]\s*/).filter(function(s){ return s.trim().length > 0; });
                if (numberSplits.length >= 2) {
                    numberSplits.forEach(function(opt) {
                        let cleaned = cleanSystemTags(opt).trim().replace(/^Option\s*\d+[\:\.\-]?\s*/i, "");
                        if (cleaned && results.length < 10) results.push(cleaned);
                    });
                } else {
                    const blocks = cardsData.split(/\n\s*\n+/).filter(function(s){ return s.trim().length > 0; });
                    blocks.forEach(function(block) {
                        let cleaned = cleanSystemTags(block).trim();
                        cleaned = cleaned.replace(/^[-*•\s\d\.:]+/, "").trim();
                        if (cleaned && results.length < 10) results.push(cleaned);
                    });
                }
            }
        }

        const cardsWrapper = document.createElement("div");
        cardsWrapper.className = "flex flex-col gap-4 w-full";

        results.forEach((cardText, index) => {
            if (!cardText || cardText.trim() === '') return;

            cardText = cardText.replace(/[\s0-9]+$/, '').trim();
            cardText = cardText.replace(/\b(i|me)\s+rides\s+bike(s)?\b/gi, "i ride my bike");
            cardText = cardText.replace(/\b(i|me)\s+rides\b/gi, "i ride");
            cardText = cardText.replace(/^rides\s+bike(s)?\b/gi, "riding bikes");
            cardText = cardText.replace(/\brides\s+bike(s)?\b/gi, "riding bikes");
            cardText = cardText.replace(/\b(i|me)\s+goes\b/gi, "i go");
            cardText = cardText.replace(/\b(i|me)\s+plays\b/gi, "i play");
            cardText = cardText.replace(/settle this[\:\,\s]*/gi, "real question: ").trim();

            if (state.shorthandOption !== false) {
                cardText = cardText.toLowerCase();
            }
            if (state.emojiOption === 0) {
                try {
                    cardText = cardText.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), "").trim();
                } catch(e) {
                    cardText = cardText.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, "").trim();
                }
            } else if (state.emojiOption === 2) {
                const expressivePool = ["😏", "😉", "👀", "🔥", "✨", "💅", "☕", "💯", "🥂", "⚡"];
                let existingCount = 0;
                try {
                    const matches = cardText.match(new RegExp('\\p{Extended_Pictographic}', 'gu'));
                    existingCount = matches ? matches.length : 0;
                } catch(e) {
                    const matches2 = cardText.match(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g);
                    existingCount = matches2 ? matches2.length : 0;
                }
                if (existingCount < 2) {
                    const needed = 2 - existingCount;
                    for (let ei = 0; ei < needed; ei++) {
                        const randEmoji = expressivePool[Math.floor(Math.random() * expressivePool.length)];
                        cardText += " " + randEmoji;
                    }
                }
            }

            const cardEl = document.createElement('div');
            cardEl.className = 'option-card stagger-card-entry';
            cardEl.style.cssText = "margin-bottom: 0px !important; background: rgba(20, 15, 38, 0.6); border: 1px solid #2e1a47; border-radius: 12px; padding: 20px; backdrop-filter: blur(8px); display: flex; flex-direction: column; gap: 12px; position: relative; transition: all 0.3s ease; animation-delay: " + (index * 0.05) + "s;";

            const headerEl = document.createElement('div');
            headerEl.className = 'card-header flex justify-between items-center w-full';

            const badgeEl = document.createElement('span');
            badgeEl.className = 'option-badge option-label text-[11px] font-bold text-violet-400 font-label uppercase tracking-widest';
            let activeLabel = "OPTION";
            if (containerId === "optimizeResultsState") {
                activeLabel = state.selectedBioStyle || state.activeStyle || "PUNCHY";
            } else if (containerId === "icebreakResultsState") {
                activeLabel = state.selectedVibe || state.activeVibe || "DIRECT";
            } else if (containerId === "analyzeResultsCards") {
                activeLabel = state.selectedTone || state.activeTone || "WITTY";
            } else {
                activeLabel = state.selectedBioStyle || state.activeStyle || state.activeTone || state.activeVibe || "OPTION";
            }
            const formattedLabel = (activeLabel === "hottake" ? "HOT TAKE" : activeLabel).toUpperCase();
            badgeEl.textContent = `${formattedLabel} • OPTION ${index + 1}`;

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'copy-card-btn copy-btn text-xs text-slate-400 hover:text-violet-400 transition-colors flex items-center gap-1.5 cursor-pointer';

            const copyIcon = document.createElement('span');
            copyIcon.className = 'material-symbols-outlined text-[15px]';
            copyIcon.textContent = 'content_copy';

            const copyLabel = document.createElement('span');
            copyLabel.className = 'copy-label';
            copyLabel.textContent = 'Copy';

            copyBtn.appendChild(copyIcon);
            copyBtn.appendChild(copyLabel);

            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(cardText).then(() => {
                    trackWingmanEvent('reply_copied', { feature: containerId, optionIndex: index + 1 });
                    copyLabel.textContent = 'Copied!';
                    copyIcon.textContent = 'check';
                    copyBtn.classList.add('text-emerald-400');
                    setTimeout(() => {
                        copyLabel.textContent = 'Copy';
                        copyIcon.textContent = 'content_copy';
                        copyBtn.classList.remove('text-emerald-400');
                    }, 2000);
                });
            });

            headerEl.appendChild(badgeEl);
            headerEl.appendChild(copyBtn);

            const bodyText = document.createElement('p');
            bodyText.className = 'card-content-text reply-main-text whitespace-pre-line';
            bodyText.style.cssText = "font-weight: 700 !important; font-size: 1.1rem !important; margin-top: 12px !important; color: #ffffff !important; font-family: sans-serif; line-height: 1.4; white-space: pre-wrap;";
            bodyText.textContent = cardText;

            cardEl.appendChild(headerEl);
            cardEl.appendChild(bodyText);
            cardsWrapper.appendChild(cardEl);
        });

        container.appendChild(cardsWrapper);

        let reRollCallback = "runAnalysis";
        if (containerId === "icebreakResultsState") reRollCallback = "generateIcebreaker";
        else if (containerId === "optimizeResultsState") reRollCallback = "runAudit";

        const refreshBtn = document.createElement("button");
        refreshBtn.type = "button";
        refreshBtn.className = "re-roll-btn mt-4 w-full bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:text-white hover:bg-violet-600/50 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all";

        const refreshIcon = document.createElement("span");
        refreshIcon.className = "material-symbols-outlined text-[14px]";
        refreshIcon.textContent = "refresh";

        const refreshLabel = document.createElement("span");
        refreshLabel.textContent = "Re-Roll Variations";

        refreshBtn.appendChild(refreshIcon);
        refreshBtn.appendChild(refreshLabel);

        refreshBtn.addEventListener("click", function(e) {
            if (typeof window[reRollCallback] === "function") {
                window[reRollCallback](e);
            }
        });

        container.appendChild(refreshBtn);
    };

    function enforceWordLimitClient(str, maxWords) {
        maxWords = maxWords || 500;
        if (!str || typeof str !== "string") return str;
        const words = str.trim().split(/\s+/);
        if (words.length > maxWords) return words.slice(0, maxWords).join(" ");
        return str;
    }

    // ============================================================
    // GENERATION CONTROLLERS – no local credit deduction
    // ============================================================
    window.runAnalysis = async function (e) {
        if (e) e.preventDefault();
        if (state.isLoading) return;
        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }

        const useCache = (state.activeTranscriptCache && state.uploadedFiles.length === 0);
        if (!useCache && state.uploadedFiles.length === 0) {
            window.showToast("Please tap the upload box to select at least 1 chat screenshot!", "warning");
            return;
        }

        if (!(await hasSufficientCredits(10))) return;

        state.isLoading = true;
        setButtonLoadingState("runAnalysisBtn", true, "Analyzing Context...", "Generate Perfect Replies");
        window.setLifecycleState("ANALYZING");
        startTelemetryTracker("analyze", "analyze-telemetry-status", "analyze-telemetry-pct", "analyze-telemetry-bar", ANALYZE_MESSAGES);

        try {
            const tone = state.activeTone || "Witty";
            let toneInstruction = tone;
            if (tone === "closer") toneInstruction = "closer (Forces a transition to get her number/Instagram/date)";

            const imageList = useCache ? [] : (state.uploadedFiles && state.uploadedFiles.length > 0 ? state.uploadedFiles : []);
            let rawUserText = useCache ? state.activeTranscriptCache : (imageList[0] || "");
            rawUserText = enforceWordLimitClient(rawUserText, 500);

            const promptPayload = {
                tone: toneInstruction,
                image: imageList[0] || null,
                images: imageList,
                temperature: 0.8,
                shorthandOption: state.shorthandOption !== false,
                emojiOption: state.emojiOption !== undefined ? state.emojiOption : 1,
                messages: [
                    {
                        role: "system",
                        content: "Generate 10 copy-pasteable option variations for a chat reply based on tone: " + toneInstruction + ". Strict format: output [REPLY_OPTION_1] content [PSYCHOLOGY_1] content and repeat for options up to 10."
                    },
                    {
                        role: "user",
                        content: rawUserText
                    }
                ]
            };

            const aiText = await window.generateWingmanResponse('/api/analyze', promptPayload);

            if (aiText && (Array.isArray(aiText) ? aiText.length > 0 : String(aiText).trim().length > 0)) {
                let momentumVal = "Stable Momentum";
                if (typeof aiText === 'string') {
                    const momentumMatch = aiText.match(/\[MOMENTUM_STATUS\]\s*([\s\S]*?)(?=\[|$)/i);
                    if (momentumMatch && momentumMatch[1]) momentumVal = momentumMatch[1].trim();
                }

                const momentumStatusValEl = $("momentum-status-val");
                if (momentumStatusValEl) momentumStatusValEl.textContent = momentumVal;

                const meterFillEl = $("meter-fill");
                if (meterFillEl) meterFillEl.style.setProperty('width', '85%', 'important');

                state.activeTranscriptCache = useCache ? state.activeTranscriptCache : "Screenshot Context Decoded successfully.";

                const cleanAiText = typeof aiText === 'string' ? aiText.replace(/\[MOMENTUM_STATUS\][\s\S]*?(?=\[|$)/i, "") : aiText;
                window.renderFiveCards("analyzeResultsCards", cleanAiText);
                window.setLifecycleState("REVEALED");
                window.updateHUDScoreBadge();
                window.showToast("Master Strategy Generated! (10 Credits Processed)", "success");
            } else {
                window.setLifecycleState(state.uploadedFiles.length > 0 ? "SELECTED" : "EMPTY");
            }
        } catch (err) {
            console.error("Screenshot Analysis Error:", err);
            window.setLifecycleState(state.uploadedFiles.length > 0 ? "SELECTED" : "EMPTY");
            if (typeof window.showToast === 'function') {
                window.showToast(err.message || "Screenshot analysis failed. Your credits were preserved.", "error");
            }
        } finally {
            stopTelemetryTracker("analyze", "analyze-telemetry-status", "analyze-telemetry-pct", "analyze-telemetry-bar", "ANALYSIS COMPLETE");
            state.isLoading = false;
            setButtonLoadingState("runAnalysisBtn", false, "Analyzing Context...", "Generate Perfect Replies");
            window.updateTermsLockState();
            window.updateButtonStates();
        }
    };

    window.generateIcebreaker = async function (e) {
        if (e) e.preventDefault();
        if (state.isLoading) return;

        const bi = $("bioInput");
        let text = bi ? bi.value.trim() : "";
        if (text.length < 5) {
            window.showNotification("Input Required", "You must enter a valid text input of at least 5 characters first.", "error");
            return;
        }
        if (text.length > 5000) {
            window.showNotification("Length Limit Exceeded", "Your message is too long. Maximum: 5,000 characters.", "error");
            return;
        }
        text = enforceWordLimitClient(text, 500);

        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }

        if (!(await hasSufficientCredits(10))) return;

        state.isLoading = true;
        setButtonLoadingState("generateIcebreakerBtn", true, "Crafting Openers...", "Generate Icebreaker");

        const emp = $("icebreakEmptyState"), skel = $("icebreakSkeletonState"), res = $("icebreakResultsState");
        if (emp) emp.classList.add("hidden");
        if (skel) skel.classList.remove("hidden");
        if (res) res.classList.add("hidden");

        startTelemetryTracker("icebreaker", "icebreak-telemetry-status", "icebreak-telemetry-pct", "icebreak-telemetry-bar", ICEBREAK_MESSAGES);

        try {
            const vibe = state.selectedVibe || "Direct";
            let vibeInstruction = vibe;
            if (vibe === "debate") vibeInstruction = "debate (Generates a low-stakes playful contrarian debate to force a reply)";

            const promptPayload = {
                vibe: vibeInstruction,
                bioText: text,
                temperature: 0.8,
                shorthandOption: state.shorthandOption !== false,
                emojiOption: state.emojiOption !== undefined ? state.emojiOption : 1,
                messages: [
                    {
                        role: "system",
                        content: "Generate 10 copy-pasteable icebreakers to send TO the person whose profile/bio is provided, based on vibe: " + vibeInstruction + ". CRITICAL: Do NOT write in the first-person voice of the profile owner (do NOT say 'Hi, I'm Neha' or introduce yourself as the profile owner). Instead, write messages that a user can send to them to start a conversation, referencing their profile details. Strict format: output [ICEBREAKER_OPTION_1] content and repeat for options up to 10."
                    },
                    {
                        role: "user",
                        content: text
                    }
                ]
            };

            const aiText = await window.generateWingmanResponse('/api/icebreaker', promptPayload);

            if (aiText) {
                if (skel) skel.classList.add("hidden");
                if (res) {
                    res.classList.remove("hidden");
                    state.icebreakCardsData = aiText;
                    window.renderFiveCards("icebreakResultsState", aiText);
                    saveSessionState();
                }
                window.showToast("Icebreakers Generated! (10 Credits Processed)", "success");
            } else {
                if (emp) emp.classList.remove("hidden");
                if (skel) skel.classList.add("hidden");
            }
        } catch (err) {
            console.error("Icebreaker Error:", err);
            if (emp) emp.classList.remove("hidden");
            if (skel) skel.classList.add("hidden");
            if (typeof window.showToast === 'function') {
                window.showToast(err.message || "Icebreaker generation failed. Your credits were preserved.", "error");
            }
        } finally {
            stopTelemetryTracker("icebreaker", "icebreak-telemetry-status", "icebreak-telemetry-pct", "icebreak-telemetry-bar", "OPENERS CRAFTED");
            state.isLoading = false;
            setButtonLoadingState("generateIcebreakerBtn", false, "Crafting Openers...", "Generate Icebreaker");
            window.updateTermsLockState();
        }
    };

    window.runAudit = async function (e) {
        if (e) e.preventDefault();
        if (state.isLoading) return;

        const ai = $("auditBioInput");
        let raw = ai ? ai.value.trim() : "";
        if (raw.length < 5) {
            window.showNotification("Input Required", "You must enter a valid bio of at least 5 characters first.", "error");
            return;
        }
        const bioWords = countWords(raw);
        if (bioWords > 500) {
            window.showNotification("Word Limit Exceeded", `Your bio exceeds the 500-word limit (${bioWords} words entered). Maximum allowed: 500 words.`, "error");
            return;
        }
        raw = enforceWordLimitClient(raw, 500);

        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }

        if (!(await hasSufficientCredits(10))) return;

        state.isLoading = true;
        setButtonLoadingState("runAuditBtn", true, "Optimizing Bio...", "Optimize My Bio");

        const emp = $("optimizeEmptyState"), skel = $("optimizeSkeletonState"), res = $("optimizeResultsState");
        if (emp) emp.classList.add("hidden");
        if (skel) skel.classList.remove("hidden");
        if (res) res.classList.add("hidden");

        startTelemetryTracker("optimize", "optimize-telemetry-status", "optimize-telemetry-pct", "optimize-telemetry-bar", OPTIMIZE_MESSAGES);

        try {
            const style = state.selectedBioStyle || "Punchy";
            let styleInstruction = style;
            if (style === "hottake") styleInstruction = "hottake (Generates a polarizing, funny bio opener)";

            const promptPayload = {
                style: styleInstruction,
                bioText: raw,
                temperature: 0.8,
                shorthandOption: state.shorthandOption !== false,
                emojiOption: state.emojiOption !== undefined ? state.emojiOption : 1,
                messages: [
                    {
                        role: "system",
                        content: "Generate 10 copy-pasteable profile bio variations for a dating profile based on style: " + styleInstruction + ". Strict format: output [BIO_OPTION_1] content and repeat for options up to 10."
                    },
                    {
                        role: "user",
                        content: raw
                    }
                ]
            };

            const aiText = await window.generateWingmanResponse('/api/optimize', promptPayload);

            if (aiText) {
                if (skel) skel.classList.add("hidden");
                if (res) {
                    res.classList.remove("hidden");
                    state.optimizeCardsData = aiText;
                    window.renderFiveCards("optimizeResultsState", aiText);
                    saveSessionState();
                }
                window.showToast("Bio Options Generated! (10 Credits Processed)", "success");
            } else {
                if (emp) emp.classList.remove("hidden");
                if (skel) skel.classList.add("hidden");
            }
        } catch (err) {
            console.error("Bio Optimizer Error:", err);
            if (emp) emp.classList.remove("hidden");
            if (skel) skel.classList.add("hidden");
            if (typeof window.showToast === 'function') {
                window.showToast(err.message || "Bio optimization failed. Your credits were preserved.", "error");
            }
        } finally {
            stopTelemetryTracker("optimize", "optimize-telemetry-status", "optimize-telemetry-pct", "optimize-telemetry-bar", "BIO OPTIMIZED");
            state.isLoading = false;
            setButtonLoadingState("runAuditBtn", false, "Optimizing Bio...", "Optimize My Bio");
            window.updateTermsLockState();
        }
    };

    // ============================================================
    // PRACTICE PARTNER CHAT DRILL PROTOCOLS & WINDOW EXPORTS
    // ============================================================
    const practicePartnerGreetings = [
        "Hey! Ready to practice your conversation skills? Pick a scenario and send your opener!",
        "Hey there! What scenario do you want to practice today?",
        "Hey! Let's drill text responses. Send your opener whenever you're ready!"
    ];

    window.currentAttractionScore = 65;
    window.sessionStats = {
        messagesSent: 0,
        attractionHistory: [65],
        dryMessageCount: 0,
        totalWords: 0,
        apologyCount: 0,
        hasDateOffer: false
    };

    window.loadPresetBio = function(btn) {
        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }
        const bi = $("bioInput");
        if (bi && btn && typeof btn.getAttribute === 'function' && btn.getAttribute("data-sample")) {
            bi.value = btn.getAttribute("data-sample");
            window.showToast("Sample bio loaded", "info");
            window.updateButtonStates();
        }
    };

    window.selectPracticeScenario = function(btnEl, scenarioName) {
        document.querySelectorAll('.scenario-chip, .scenario-pill').forEach(btn => {
            btn.classList.remove('active', 'bg-gradient-to-r', 'from-violet-600', 'to-indigo-600', 'border-violet-400/50', 'text-white', 'font-bold', 'shadow-md', 'shadow-violet-950/40');
            btn.classList.add('bg-neutral-900/90', 'border-white/15', 'text-slate-300', 'font-medium');
        });
        if (btnEl) {
            btnEl.classList.remove('bg-neutral-900/90', 'border-white/15', 'text-slate-300', 'font-medium');
            btnEl.classList.add('active', 'bg-gradient-to-r', 'from-violet-600', 'to-indigo-600', 'border-violet-400/50', 'text-white', 'font-bold', 'shadow-md', 'shadow-violet-950/40');
        }
        window.activePracticeScenario = scenarioName;
        window.activePracticeMode = (scenarioName === 'Coach Hotline' || (btnEl && btnEl.dataset && btnEl.dataset.mode === 'hotline')) ? 'hotline' : 'roleplay';
        if (typeof window.clearAndResetChatbox === 'function') window.clearAndResetChatbox();
    };

    window.clearAndResetChatbox = function() {
        activeSimulatorThread = [];
        activeSimulatorThread.push({ role: "system", content: practicePartnerSystemContext });

        window.currentAttractionScore = 65;
        window.sessionStats = {
            messagesSent: 0,
            attractionHistory: [65],
            dryMessageCount: 0,
            totalWords: 0,
            apologyCount: 0,
            hasDateOffer: false
        };

        const isHotline = (window.activePracticeMode === "hotline" || window.activePracticeScenario === "Coach Hotline" || !window.activePracticeScenario);
        if (isHotline) {
            window.activePracticeMode = "hotline";
            window.activePracticeScenario = "Coach Hotline";
        }

        if (window.updateAttractionMeter) window.updateAttractionMeter(65, 0);
        if (window.updateCharacterMood) window.updateCharacterMood(isHotline ? "Coach 🧠" : "Playful 😏");

        const container = $("chatbox-messages-container");
        if (container) {
            container.innerHTML = "";
            const openingLine = isHotline
                ? "Hey! I'm Maeve, your AI Dating & Communication Coach. What can I help you with today? Ask me for texting advice, help drafting a reply, analyzing a situation, or dating strategy!"
                : practicePartnerGreetings[Math.floor(Math.random() * practicePartnerGreetings.length)];
            window.renderChatboxBubble(openingLine, "assistant");
            activeSimulatorThread.push({ role: "assistant", content: openingLine });
        }
    };

    window.resetPracticeChat = function() {
        if (typeof window.clearAndResetChatbox === 'function') {
            window.clearAndResetChatbox();
        }
    };

    window.renderChatboxBubble = function(text, sender) {
        const container = $("chatbox-messages-container");
        if (!container) return;

        let cleanText = text;
        if (typeof cleanText === "string") {
            cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/gi, "");
            cleanText = cleanText.replace(/```json[\s\S]*?```/gi, "");
            cleanText = cleanText.replace(/```[\s\S]*?```/gi, "");
            cleanText = cleanText.replace(/[\{\}\[\]]/g, "");
            cleanText = cleanText.replace(/[\#\*\_\|\`\>]/g, "");
            cleanText = cleanText.replace(/^\s*[\-\*]\s+/gm, "• ");

            cleanText = cleanText.replace(/\s*[\-\—\=]{3,}\s*/g, "\n\n");
            cleanText = cleanText.replace(/([^\n])\s*(\b\d{1,2}\.\s+)/g, "$1\n\n$2");
            cleanText = cleanText.replace(/([^\n])\s*(•\s+)/g, "$1\n\n$2");
            cleanText = cleanText.replace(/([^\n])\s*(💡\s*Pro Tip:|Pro Tip:|💡\s*Tip:|Note:|Want me to|Let me know if|Just say the word)/gi, "$1\n\n$2");
            cleanText = cleanText.replace(/\n{3,}/g, "\n\n");

            cleanText = cleanText.trim();
            const isHotlineMode = window.activePracticeMode === "hotline" || (window.activePracticeScenario === "Coach Hotline");
            if (!isHotlineMode && (sender === "assistant" || sender === "girlfriend" || sender === "maeve")) {
                cleanText = cleanText.toLowerCase();
            }
        }

        const bubble = document.createElement("div");
        bubble.className = "animate-chat-bubble";
        bubble.style.maxWidth = "85%";
        bubble.style.padding = "12px 16px";
        bubble.style.borderRadius = "14px";
        bubble.style.fontSize = "14px";
        bubble.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
        bubble.style.lineHeight = "1.5";
        bubble.style.wordBreak = "break-word";
        bubble.style.whiteSpace = "pre-wrap";
        if (sender === "user") {
            bubble.style.alignSelf = "flex-end";
            bubble.style.background = "linear-gradient(135deg, #a855f7 0%, #6b21a8 100%)";
            bubble.style.color = "#fff";
            bubble.style.borderBottomRightRadius = "2px";
        } else {
            bubble.style.alignSelf = "flex-start";
            bubble.style.background = "#1a122c";
            bubble.style.border = "1px solid #2e1a47";
            bubble.style.color = "#fff";
            bubble.style.borderBottomLeftRadius = "2px";
        }

        bubble.textContent = cleanText;
        container.appendChild(bubble);
        window.scrollToBottom(true);
    };

    window.scrollToBottom = function(smooth = true) {
        const container = $("chatbox-messages-container") || document.getElementById("chatbox-messages-container");
        if (!container) return;
        try {
            container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
        } catch(e) {
            container.scrollTop = container.scrollHeight;
        }
    };

    window.showChatboxTypingIndicator = function(show) {
        const container = $("chatbox-messages-container");
        if (!container) return;
        const existing = $("chatbox-typing-indicator");
        if (existing) existing.remove();
        if (show) {
            const indicator = document.createElement("div");
            indicator.id = "chatbox-typing-indicator";
            indicator.style.alignSelf = "flex-start";
            indicator.style.background = "#1a122c";
            indicator.style.border = "1px solid #2e1a47";
            indicator.style.color = "#a855f7";
            indicator.style.padding = "10px 14px";
            indicator.style.borderRadius = "12px";
            indicator.style.borderBottomLeftRadius = "2px";
            indicator.style.fontSize = "14px";
            indicator.textContent = "Typing...";
            container.appendChild(indicator);
            container.scrollTop = container.scrollHeight;
        }
    };

    window.renderTurnEvaluationCard = function(evalData) {
        if (!evalData) return;
        const container = $("chatbox-messages-container");
        if (!container) return;

        const isSuccess = evalData.status === "PASSED";
        const badgeColor = isSuccess ? "#10b981" : (evalData.status === "FAILED" ? "#ef4444" : "#f59e0b");
        const badgeBg = isSuccess ? "rgba(16, 185, 129, 0.15)" : (evalData.status === "FAILED" ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)");
        const badgeBorder = isSuccess ? "rgba(16, 185, 129, 0.4)" : (evalData.status === "FAILED" ? "rgba(239, 68, 68, 0.4)" : "rgba(245, 158, 11, 0.4)");
        const badgeText = evalData.status === "PASSED" ? "HIGH STATUS • SCORE " + evalData.score + "/100" : (evalData.status === "FAILED" ? "DRILL FAILED • SCORE " + evalData.score + "/100" : "NEEDS REFINEMENT • SCORE " + evalData.score + "/100");

        const card = document.createElement("div");
        card.className = "animate-chat-bubble turn-eval-card";
        card.style.cssText = "align-self: center; width: 94%; max-width: 520px; background: rgba(18, 14, 32, 0.95); border: 1px solid " + badgeBorder + "; border-radius: 14px; padding: 12px 16px; font-size: 12px; color: #e2e8f0; font-family: sans-serif; line-height: 1.5; margin: 8px 0; box-shadow: 0 6px 20px rgba(0,0,0,0.4); border-left: 4px solid " + badgeColor + ";";

        let html = '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">';
        html += '<span style="background: ' + badgeBg + '; border: 1px solid ' + badgeBorder + '; color: ' + badgeColor + '; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; font-family: monospace;">' + badgeText + '</span>';
        html += '<button type="button" onclick="window.retryLastTurn()" style="background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #c084fc; font-size: 11px; padding: 2px 8px; border-radius: 6px; cursor: pointer; font-weight: 600;">↺ Retry Turn</button>';
        html += '</div>';

        html += '<div style="color: #cbd5e1; font-size: 12px; margin-bottom: 4px;"><strong>Feedback:</strong> ' + esc(evalData.critique || '') + '</div>';

        if (evalData.alternative) {
            html += '<div style="color: #a855f7; font-size: 11.5px; background: rgba(168, 85, 247, 0.1); padding: 6px 10px; border-radius: 8px; border: 1px dashed rgba(168, 85, 247, 0.3); margin-top: 4px;"><strong>Suggested High-Status Line:</strong> "' + esc(evalData.alternative || '') + '"</div>';
        }

        card.innerHTML = html;
        container.appendChild(card);
        window.scrollToBottom(true);
    };

    window.retryLastTurn = function() {
        const container = $("chatbox-messages-container");
        if (!container) return;

        if (activeSimulatorThread.length >= 2) {
            activeSimulatorThread.pop();
            activeSimulatorThread.pop();
        }

        const bubbles = container.querySelectorAll(".animate-chat-bubble");
        const toRemove = Math.min(3, bubbles.length);
        for (let i = 0; i < toRemove; i++) {
            bubbles[bubbles.length - 1 - i].remove();
        }

        const inputField = $("simulator-chat-input");
        if (inputField) inputField.focus();
        window.showToast("Turn reset! Try sending a higher-status line.", "info");
    };

    window.updateAttractionMeter = function(score, delta) {
        const numScore = Math.max(0, Math.min(100, Number(score) || 60));
        window.currentAttractionScore = numScore;
        if (window.sessionStats && window.sessionStats.attractionHistory) {
            window.sessionStats.attractionHistory.push(numScore);
        }
    };

    window.updateCharacterMood = function(moodStr) {};
    window.renderInFeedCheckpointCard = function(checkpointData, turnIndex) {};

    window.replayFromTurn = function(targetTurnIndex) {
        const container = $("chatbox-messages-container");
        if (!container) return;

        if (targetTurnIndex >= 0 && targetTurnIndex < activeSimulatorThread.length) {
            activeSimulatorThread = activeSimulatorThread.slice(0, targetTurnIndex);
        }

        container.innerHTML = "";
        activeSimulatorThread.forEach(function(msg) {
            if (msg.role !== 'system') {
                window.renderChatboxBubble(msg.content || msg.text, msg.role);
            }
        });

        const inputField = $("simulator-chat-input");
        if (inputField) inputField.focus();
        window.showToast("Rewound to Message #" + targetTurnIndex + ". Try a new high-status angle!", "info");
    };

    window.openHolisticReviewModal = function() {
        if (window.triggerFinishAndReview) window.triggerFinishAndReview();
    };

    window.closeHolisticReviewModal = function() {
        if (window.closeSessionReviewModal) window.closeSessionReviewModal();
    };

    window.submitChatboxMessage = async function() {
        const inputField = $("simulator-chat-input");
        if (!inputField) return;
        let userText = inputField.value.trim();
        if (!userText) return;

        if (userText.length > 5000) {
            window.showNotification("Length Limit Exceeded", "Your message is too long. Maximum: 5,000 characters.", "error");
            return;
        }

        userText = enforceWordLimitClient(userText, 500);

        if (!(await hasSufficientCredits(2))) return;

        const sendBtn = $("chatbox-send-btn");
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.classList.add("opacity-50", "cursor-not-allowed");
        }

        const isDryMsg = /^(hi|hello|hey|nothing|idk|ok|k|whatever|dunno|nevermind|nm)$/i.test(userText);
        const isApologyMsg = /sorry|apologize|my bad/i.test(userText);
        const hasDateMsg = /(coffee|drinks?|rooftop|dinner|lunch|bar)\b.*(this|on|at|around)?\s*(thursday|friday|saturday|sunday|weekend|8\s*pm|7\s*pm)/i.test(userText);

        if (!window.sessionStats) {
            window.sessionStats = { messagesSent: 0, attractionHistory: [65], dryMessageCount: 0, totalWords: 0, apologyCount: 0, hasDateOffer: false };
        }
        window.sessionStats.messagesSent++;
        window.sessionStats.totalWords += userText.split(/\s+/).length;
        if (isDryMsg) window.sessionStats.dryMessageCount++;
        if (isApologyMsg) window.sessionStats.apologyCount++;
        if (hasDateMsg) window.sessionStats.hasDateOffer = true;

        inputField.value = "";
        window.renderChatboxBubble(userText, "user");
        try {
            inputField.focus();
            if (window.innerWidth < 768) {
                document.body.classList.add("chat-keyboard-open");
            }
        } catch(e) {}
        window.scrollToBottom(true);

        if (activeSimulatorThread.length === 0) {
            activeSimulatorThread.push({ role: "system", content: practicePartnerSystemContext });
        }

        activeSimulatorThread.push({ role: "user", content: userText, text: userText, attractionScore: window.currentAttractionScore });
        window.showChatboxTypingIndicator(true);

        try {
            const apiBase = getApiBase();
            const activeScenario = window.activePracticeScenario || "Coach Hotline";
            const isHotlineMode = (window.activePracticeMode === "hotline" || activeScenario === "Coach Hotline");
            const activeMode = isHotlineMode ? "hotline" : "roleplay";

            const authHeaders = (typeof window.getSupabaseAuthHeaders === 'function') ? await window.getSupabaseAuthHeaders() : {};
            const headers = {
                'Content-Type': 'application/json',
                ...authHeaders
            };

            const chatResp = await fetch((apiBase || '') + '/api/chat', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    messages: activeSimulatorThread,
                    scenario: activeScenario,
                    mode: activeMode,
                    isHotline: isHotlineMode,
                    attractionScore: window.currentAttractionScore
                })
            });

            window.showChatboxTypingIndicator(false);

            if (chatResp.ok) {
                const chatData = await chatResp.json();
                if (chatData && chatData.reply) {
                    const aiReply = chatData.reply;
                    activeSimulatorThread.push({ role: "assistant", content: aiReply });
                    window.renderChatboxBubble(aiReply, "assistant");
                    const updatedBal = typeof chatData.credits === 'number' ? chatData.credits : (typeof chatData.creditsRemaining === 'number' ? chatData.creditsRemaining : null);
                    if (updatedBal !== null) {
                        window.updateUICredits(updatedBal);
                    }
                } else if (chatData && chatData.error) {
                    window.renderChatboxBubble("Notice: " + chatData.error, "assistant");
                }
            } else if (chatResp.status === 409) {
                const errJson = await chatResp.json().catch(() => ({}));
                if (typeof window.checkCreditBalance === 'function') await window.checkCreditBalance();
                window.renderChatboxBubble(errJson.error || "This message is already being processed. No additional credits were deducted.", "assistant");
            } else if (chatResp.status === 403) {
                const errJson = await chatResp.json().catch(() => ({}));
                if (errJson.code === "CONSENT_REQUIRED" || (errJson.error && errJson.error.toLowerCase().includes("consent"))) {
                    state.isTermsAccepted = false;
                    state.consentStatus = 'consent_required';
                    safeStorage.remove('wingman_terms_accepted');
                    safeStorage.remove('wingman_consent_version');
                    if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                    if (typeof window.openInterstitialModal === 'function') window.openInterstitialModal();
                }
                window.renderChatboxBubble("18+ age verification and consent required to continue chatting.", "assistant");
            } else if (chatResp.status === 503) {
                const errJson = await chatResp.json().catch(() => ({}));
                if (errJson.code === "CONSENT_SERVICE_UNAVAILABLE") {
                    state.isTermsAccepted = false;
                    state.consentStatus = 'service_unavailable';
                    safeStorage.remove('wingman_terms_accepted');
                    if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                    if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                    window.renderChatboxBubble("Consent verification service is temporarily unavailable. Features remain locked.", "assistant");
                } else {
                    window.renderChatboxBubble(errJson.error || "Credit service is temporarily unavailable. Please try again later.", "assistant");
                }
            } else if (chatResp.status === 402) {
                const errJson = await chatResp.json().catch(() => ({}));
                const authoritativeChatBalance = await window.checkCreditBalance();
                if (!authoritativeChatBalance || !authoritativeChatBalance.success || typeof state.credits !== 'number') {
                    window.renderChatboxBubble("The credit service rejected this message, but your wallet could not be verified. Please refresh or sign in again.", "assistant");
                } else if (state.credits >= 2) {
                    window.renderChatboxBubble("Your wallet has enough credits, but this message was rejected by the credit service. Please refresh or sign in again; no purchase is required.", "assistant");
                } else {
                    window.renderChatboxBubble(errJson.error || "⚠️ Insufficient credits. Please top up credits to continue practicing.", "assistant");
                    if (typeof window.openPurchaseModal === 'function') window.openPurchaseModal();
                }
            } else {
                const errJson = await chatResp.json().catch(() => ({}));
                if (typeof errJson.credits === 'number') {
                    window.updateUICredits(errJson.credits);
                }
                const errMsg = errJson.error || "Sorry, Maeve is taking a quick breath. If you were charged credits, please contact support.mywingman@gmail.com.";
                window.renderChatboxBubble("Notice: " + errMsg, "assistant");
            }
        } catch (chatErr) {
            window.showChatboxTypingIndicator(false);
            console.error("Chatbox API Error:", chatErr);
            window.renderChatboxBubble("Connection issue. Please check your network and try again.", "assistant");
        } finally {
            if (typeof window.updateButtonStates === 'function') {
                window.updateButtonStates();
            }
        }
    };

    window.openInterstitialModal = function() {
        const m = document.getElementById("interstitialModal");
        const c = document.getElementById("interstitialCard");
        if (!m) return;
        m.style.display = "flex";
        m.classList.remove("hidden", "opacity-0", "pointer-events-none");
        m.classList.add("opacity-100", "pointer-events-auto");
        if (c) {
            c.classList.remove("scale-95");
            c.classList.add("scale-100");
        }
    };

    window.closeInterstitialModal = function(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const m = document.getElementById("interstitialModal");
        const c = document.getElementById("interstitialCard");
        if (c) {
            c.classList.remove("scale-100");
            c.classList.add("scale-95");
        }
        if (m) {
            m.classList.remove("opacity-100", "pointer-events-auto");
            m.classList.add("opacity-0", "pointer-events-none", "hidden");
            m.style.display = "none";
        }
    };

    window.toggleInterstitialAcceptButton = function() {
        const chk = document.getElementById('interstitialAgreementCheck');
        const btn = document.getElementById('interstitialAcceptBtn');
        if (!btn) return;
        if (chk && chk.checked) {
            btn.classList.remove('opacity-50', 'pointer-events-none');
            btn.classList.add('opacity-100', 'pointer-events-auto');
            btn.disabled = false;
        } else {
            btn.classList.add('opacity-50', 'pointer-events-none');
            btn.classList.remove('opacity-100', 'pointer-events-auto');
            btn.disabled = true;
        }
    };

    window.checkServerConsentStatus = async function() {
        try {
            const isAuth = safeStorage.get("wingman_authenticated") === "true" || safeStorage.get("wingman_user_authenticated") === "true" || (typeof window.currentSupabaseUser === 'object' && window.currentSupabaseUser);
            if (!isAuth) {
                state.isTermsAccepted = false;
                state.consentStatus = 'unauthenticated';
                safeStorage.remove('wingman_terms_accepted');
                if (typeof window.closeInterstitialModal === 'function') window.closeInterstitialModal();
                if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                return false;
            }
            const authHeaders = (typeof window.getSupabaseAuthHeaders === 'function') ? await window.getSupabaseAuthHeaders() : {};
            if (!authHeaders || !authHeaders.Authorization) {
                state.isTermsAccepted = false;
                state.consentStatus = 'unauthenticated';
                safeStorage.remove('wingman_terms_accepted');
                if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                return false;
            }

            const res = await fetch((window.getApiBase ? window.getApiBase() : '') + '/api/consent/status', {
                method: 'GET',
                headers: { ...authHeaders }
            });

            if (res.status === 503) {
                state.isTermsAccepted = false;
                state.consentStatus = 'service_unavailable';
                safeStorage.remove('wingman_terms_accepted');
                if (typeof window.closeInterstitialModal === 'function') window.closeInterstitialModal();
                if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                if (typeof window.showToast === 'function') {
                    window.showToast("Consent verification service is temporarily unavailable. AI features remain locked.", "error");
                }
                return false;
            }

            if (res.ok) {
                const data = await res.json();
                if (data && data.hasActiveConsent === true) {
                    state.isTermsAccepted = true;
                    state.consentStatus = 'active';
                    safeStorage.set('wingman_terms_accepted', 'true');
                    safeStorage.set('wingman_consent_version', data.termsVersion || '2026.1');
                    if (typeof window.closeInterstitialModal === 'function') window.closeInterstitialModal();
                    if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
                    if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                    return true;
                }
            }

            // Authenticated with missing or expired consent
            state.isTermsAccepted = false;
            state.consentStatus = 'consent_required';
            safeStorage.remove('wingman_terms_accepted');
            if (typeof window.openInterstitialModal === 'function') {
                window.openInterstitialModal();
            }
            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
            if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
            return false;
        } catch (e) {
            console.warn("[Consent status check error]:", e.message);
            state.isTermsAccepted = false;
            state.consentStatus = 'service_unavailable';
            safeStorage.remove('wingman_terms_accepted');
            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
            if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
            return false;
        }
    };

    window.acceptInterstitialTerms = async function() {
        const chk = document.getElementById('interstitialAgreementCheck');
        if (!chk || !chk.checked) {
            if (typeof window.showToast === 'function') {
                window.showToast("Please check the box to confirm you are 18+ and agree to the Terms of Service & Privacy Policy.", "warning");
            }
            return;
        }

        const isAuth = safeStorage.get("wingman_authenticated") === "true" || safeStorage.get("wingman_user_authenticated") === "true" || (typeof window.currentSupabaseUser === 'object' && window.currentSupabaseUser);
        if (!isAuth) {
            if (typeof window.openAuthRequiredModal === 'function') {
                window.openAuthRequiredModal("Please sign in or create an account to record your 18+ verification and consent.");
            }
            return;
        }

        const acceptBtn = document.getElementById('interstitialAcceptBtn');
        const origText = acceptBtn ? acceptBtn.textContent : "Confirm & Enter";
        if (acceptBtn) {
            acceptBtn.disabled = true;
            acceptBtn.textContent = "Verifying & Recording…";
        }

        try {
            const authHeaders = (typeof window.getSupabaseAuthHeaders === 'function') ? await window.getSupabaseAuthHeaders() : {};
            const res = await fetch((window.getApiBase ? window.getApiBase() : '') + '/api/consent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ age18Plus: true, aiProcessingConsent: true })
            });

            const data = await res.json();
            if (!res.ok || !data.success || !data.consentRecorded) {
                throw new Error(data.error || "Failed to record persistent legal consent.");
            }

            safeStorage.set('wingman_terms_accepted', 'true');
            safeStorage.set('wingman_consent_version', data.termsVersion || '2026.1');
            safeStorage.set('wingman_consent_accepted_at', new Date().toISOString());
            state.isTermsAccepted = true;
            state.consentStatus = 'active';

            const modal = document.getElementById('interstitialModal');
            if (modal) {
                modal.classList.add('hidden', 'opacity-0', 'pointer-events-none');
                modal.classList.remove('opacity-100', 'pointer-events-auto');
                modal.style.display = 'none';
            }
            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
            if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
            if (typeof window.showToast === 'function') {
                window.showToast("18+ Age verification & legal consent successfully recorded.", "success");
            }
        } catch (err) {
            state.isTermsAccepted = false;
            safeStorage.remove('wingman_terms_accepted');
            if (typeof window.showToast === 'function') {
                window.showToast(err.message || "Failed to record legal consent. Workspace remains locked.", "error");
            }
        } finally {
            if (acceptBtn) {
                acceptBtn.disabled = false;
                acceptBtn.textContent = origText;
            }
        }
    };

    window.withdrawConsent = async function() {
        if (!confirm("Are you sure you want to withdraw your AI data processing consent? This will lock all AI generation features until you consent again.")) {
            return;
        }
        try {
            const authHeaders = (typeof window.getSupabaseAuthHeaders === 'function') ? await window.getSupabaseAuthHeaders() : {};
            const res = await fetch((window.getApiBase ? window.getApiBase() : '') + '/api/consent/withdraw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders }
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to withdraw consent.");
            }
            state.isTermsAccepted = false;
            state.consentStatus = 'withdrawn';
            safeStorage.remove('wingman_terms_accepted');
            safeStorage.remove('wingman_consent_version');
            safeStorage.remove('wingman_consent_accepted_at');
            if (typeof window.closeSettingsModal === 'function') window.closeSettingsModal();
            if (typeof window.updateTermsLockState === 'function') window.updateTermsLockState();
            if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
            if (typeof window.showToast === 'function') {
                window.showToast("AI data processing consent successfully withdrawn. AI features locked.", "info");
            }
        } catch (err) {
            if (typeof window.showToast === 'function') {
                window.showToast(err.message || "Failed to withdraw consent.", "error");
            }
        }
    };

    window.showUnreadableErrorModal = function() {
        const modal = document.getElementById('unreadableErrorModal');
        if (modal) modal.classList.remove('hidden');
    };

    window.closeUnreadableErrorModal = function(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const modal = document.getElementById('unreadableErrorModal');
        if (modal) modal.classList.add('hidden');
    };

})();
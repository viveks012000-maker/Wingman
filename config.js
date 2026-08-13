/**
 * My Wingman Client-Side Environment Configuration
 * -------------------------------------------------------------------------
 * In Localhost Development: API_BASE_URL defaults to http://localhost:3000
 * In Production (Cloudflare Pages): Set API_BASE_URL to your Railway backend URL
 * Example: window.WINGMAN_CONFIG = { API_BASE_URL: "https://your-railway-app.up.railway.app" };
 */
window.WINGMAN_CONFIG = window.WINGMAN_CONFIG || {
    API_BASE_URL: "" // Leave empty for auto-detection or specify your Railway Express backend URL
};

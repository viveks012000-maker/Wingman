/**
 * My Wingman Client-Side Environment Configuration
 * -------------------------------------------------------------------------
 * In Localhost Development: API_BASE_URL defaults to http://localhost:3000
 * In Production (Cloudflare Pages): Set API_BASE_URL to your Railway backend URL
 * Live Railway Backend: https://wingman-production-c6ce.up.railway.app
 */
window.WINGMAN_CONFIG = window.WINGMAN_CONFIG || {
    API_BASE_URL: "https://wingman-production-c6ce.up.railway.app"
};

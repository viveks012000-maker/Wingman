/**
 * =========================================================================================
 * WINGMAN BASE64 IMAGE VALIDATION MIDDLEWARE
 * =========================================================================================
 * Validates incoming screenshot payloads for the /api/analyze endpoint:
 * 1. Verifies images is an array with 1 to 5 images max.
 * 2. Checks base64 formatting and MIME types (JPEG, PNG, WEBP, GIF, HEIC).
 * 3. Rejects arbitrary remote HTTP/HTTPS URLs (SSRF and MIME bypass prevention).
 * 4. Enforces strict per-image size limit (<= 5 MB per image).
 * 5. Enforces strict total payload size limit (<= 25 MB total for all images).
 * =========================================================================================
 */

function validateImagePayload(req, res, next) {
    const isAnalyzeRoute = req.path === '/api/analyze' || 
                           req.path === '/api/analyze-chat-screenshot' || 
                           req.originalUrl.startsWith('/api/analyze');
                           
    if (!isAnalyzeRoute || req.method !== 'POST') {
        return next();
    }

    const { images } = req.body || {};
    if (!images) {
        return next(); // Let endpoint handle missing image validation
    }

    if (!Array.isArray(images)) {
        return res.status(400).json({ success: false, error: 'Invalid payload format: images must be an array.' });
    }

    if (images.length > 5) {
        return res.status(400).json({ success: false, error: 'You can analyze a maximum of 5 images at a time.' });
    }

    const ALLOWED_MIME_REGEX = /^data:image\/(jpeg|jpg|png|webp|gif|heic|heif);base64,/i;
    const MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
    const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB total for up to 5 images

    let totalDecodedBytes = 0;

    for (let i = 0; i < images.length; i++) {
        const imgStr = images[i];
        if (typeof imgStr !== 'string' || !imgStr.trim()) {
            return res.status(400).json({ success: false, error: `Invalid image string at index ${i}.` });
        }

        const trimmed = imgStr.trim();

        // Reject arbitrary remote HTTP/HTTPS URLs to prevent SSRF and MIME bypass
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return res.status(400).json({
                success: false,
                error: 'Remote image URLs are not supported. Please upload chat screenshots directly as image files.'
            });
        }

        // Validate MIME type prefix if data URI present
        if (trimmed.startsWith('data:')) {
            if (!ALLOWED_MIME_REGEX.test(trimmed)) {
                return res.status(400).json({
                    success: false,
                    error: 'This image format is not supported.'
                });
            }
        }

        // Estimate decoded base64 byte size
        const base64Data = trimmed.includes(',') ? trimmed.split(',')[1].trim() : trimmed;
        const base64Clean = base64Data.replace(/[\r\n\s]+/g, '');
        if (!/^[A-Za-z0-9+/=]+$/.test(base64Clean)) {
            return res.status(400).json({
                success: false,
                error: `Invalid or malformed base64 image data at index ${i}.`
            });
        }

        const estimatedBytes = Math.ceil((base64Clean.length * 3) / 4);

        if (estimatedBytes > MAX_PER_IMAGE_BYTES) {
            return res.status(400).json({
                success: false,
                error: 'Image is too large. Maximum size is 5 MB per image.'
            });
        }

        totalDecodedBytes += estimatedBytes;
    }

    if (totalDecodedBytes > MAX_TOTAL_BYTES) {
        return res.status(400).json({
            success: false,
            error: 'These images are too large. Maximum total upload size: 25 MB.'
        });
    }

    next();
}

module.exports = { validateImagePayload };

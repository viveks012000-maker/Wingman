/**
 * =========================================================================================
 * WINGMAN BASE64 IMAGE VALIDATION MIDDLEWARE
 * =========================================================================================
 * Validates incoming screenshot payloads for the /api/analyze endpoint:
 * 1. Verifies images is an array with 1 to 5 images max.
 * 2. Checks base64 formatting and MIME types (JPEG, PNG, WEBP, HEIC).
 * 3. Enforces strict decoded byte limits (<= 15MB per image).
 * =========================================================================================
 */

function validateImagePayload(req, res, next) {
    if (req.path !== '/api/analyze' || req.method !== 'POST') {
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
        return res.status(400).json({ success: false, error: 'Maximum image limit exceeded (max 5 screenshots per request).' });
    }

    const ALLOWED_MIME_REGEX = /^data:image\/(jpeg|jpg|png|webp|heic);base64,/i;
    const MAX_DECODED_BYTES = 15 * 1024 * 1024; // 15 MB

    for (let i = 0; i < images.length; i++) {
        const imgStr = images[i];
        if (typeof imgStr !== 'string') {
            return res.status(400).json({ success: false, error: `Invalid image string at index ${i}.` });
        }

        // Validate MIME type prefix if data URI present
        if (imgStr.startsWith('data:')) {
            if (!ALLOWED_MIME_REGEX.test(imgStr)) {
                return res.status(400).json({
                    success: false,
                    error: `Unsupported image format at index ${i}. Allowed formats: JPEG, PNG, WEBP, HEIC.`
                });
            }
        }

        // Estimate decoded base64 byte size
        const base64Data = imgStr.includes(',') ? imgStr.split(',')[1] : imgStr;
        const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);

        if (estimatedBytes > MAX_DECODED_BYTES) {
            return res.status(400).json({
                success: false,
                error: `Image ${i + 1} exceeds maximum allowable size boundary (15MB limit).`
            });
        }
    }

    next();
}

module.exports = { validateImagePayload };

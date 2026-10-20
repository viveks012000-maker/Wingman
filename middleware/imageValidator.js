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

function normalizeAnalyzerImages(body = {}) {
    const { images, image, imageBase64 } = body || {};
    const hadImageArray = Array.isArray(images);
    let rawImages = [];
    if (hadImageArray) {
        rawImages = images.length > 0 ? images : ((image || imageBase64) ? [image || imageBase64] : []);
    } else if (images) {
        return { valid: false, error: 'Invalid payload format: images must be an array.' };
    } else if (image || imageBase64) {
        rawImages = [image || imageBase64];
    }

    if (rawImages.length > 5) {
        return { valid: false, error: 'You can analyze a maximum of 5 images at a time.' };
    }

    const maxSingleImageBytes = 5 * 1024 * 1024;
    const maxTotalImageBytes = 25 * 1024 * 1024;
    const allowedMimes = new Set([
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
        'image/gif', 'image/heic', 'image/heif', 'image/bmp'
    ]);
    const imageList = [];
    let totalDecodedBytes = 0;

    for (let i = 0; i < rawImages.length; i++) {
        const item = rawImages[i];
        if (typeof item !== 'string' || !item.trim()) {
            return { valid: false, error: `Invalid image string at index ${i}.` };
        }

        const trimmed = item.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
            return { valid: false, error: 'Remote image URLs are not supported. Please upload screenshot files directly.' };
        }

        let mime = 'image/jpeg';
        let base64Data = '';
        if (trimmed.startsWith('data:')) {
            const allowedDataUrl = /^data:image\/(jpeg|jpg|png|webp|gif|heic|heif|bmp);base64,/i;
            if (!allowedDataUrl.test(trimmed)) {
                return { valid: false, error: 'This image format is not supported.' };
            }
            const match = trimmed.match(/^data:([^;]+);base64,(.+)$/s);
            if (!match) {
                return { valid: false, error: 'This image format is not supported.' };
            }
            mime = match[1].toLowerCase();
            base64Data = match[2].replace(/[\r\n\s]+/g, '');
        } else {
            base64Data = trimmed.replace(/[\r\n\s]+/g, '');
        }

        if (!allowedMimes.has(mime)) {
            return { valid: false, error: `Screenshot #${i + 1} has an unsupported format (${mime}). Supported: JPG, PNG, WEBP, HEIC, BMP.` };
        }
        const paddingIndex = base64Data.indexOf('=');
        const paddingCount = paddingIndex < 0 ? 0 : base64Data.length - paddingIndex;
        const base64ContentLength = paddingIndex < 0 ? base64Data.length : paddingIndex;
        const malformedBase64 = !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)
            || base64Data.length % 4 === 1
            || (paddingCount > 0 && base64Data.length % 4 !== 0)
            || (paddingCount === 1 && base64ContentLength % 4 !== 3)
            || (paddingCount === 2 && base64ContentLength % 4 !== 2);
        if (malformedBase64) {
            return { valid: false, error: `Invalid or malformed base64 image data at index ${i}.` };
        }

        const decodedBytes = Math.floor((base64Data.length * 3) / 4)
            - (base64Data.endsWith('==') ? 2 : (base64Data.endsWith('=') ? 1 : 0));
        if (decodedBytes <= 0) {
            return { valid: false, error: `Screenshot #${i + 1} is empty or unreadable.` };
        }
        if (decodedBytes > maxSingleImageBytes) {
            return {
                valid: false,
                error: hadImageArray
                    ? 'Image is too large. Maximum size is 5 MB per image.'
                    : `Screenshot #${i + 1} exceeds the 5 MB per-image limit.`
            };
        }

        totalDecodedBytes += decodedBytes;
        if (totalDecodedBytes > maxTotalImageBytes) {
            return { valid: false, error: 'These images are too large. Maximum total upload size: 25 MB.' };
        }

        imageList.push(`data:${mime};base64,${base64Data}`);
    }

    return { valid: true, imageList };
}

function validateImagePayload(req, res, next) {
    const originalUrl = String(req.originalUrl || '');
    const isAnalyzeRoute = req.path === '/api/analyze'
        || req.path === '/api/analyze-chat-screenshot'
        || originalUrl.startsWith('/api/analyze');

    if (!isAnalyzeRoute || req.method !== 'POST') return next();

    const validation = normalizeAnalyzerImages(req.body || {});
    if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
    }
    req.validatedAnalyzerImages = validation.imageList;
    return next();
}

module.exports = { validateImagePayload, normalizeAnalyzerImages };

/**
 * =========================================================================================
 * WINGMAN EMAIL SERVICE UTILITY
 * =========================================================================================
 * Provides sendEmail() for transactional emails (verification, password reset, etc.)
 * Uses console-based logging as fallback when no SMTP/nodemailer is configured.
 * Install nodemailer and configure SMTP_* env vars to enable real email delivery.
 * =========================================================================================
 */

// Nodemailer is optional — only load if installed
let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    // nodemailer not installed; all emails are logged to console.
}

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Attempt to create a real SMTP transporter from environment config.
 * Returns null if nodemailer is unavailable or SMTP is not configured.
 */
function createTransporter() {
    if (!nodemailer) return null;
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) return null;

    try {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || ''
            }
        });
    } catch (e) {
        console.warn('[Email] Failed to create SMTP transporter:', e.message);
        return null;
    }
}

/**
 * Send an email.
 *
 * @param {Object} options
 * @param {string} options.to       - Recipient email address
 * @param {string} options.subject  - Email subject line
 * @param {string} options.text     - Plain-text body
 * @param {string} [options.html]   - HTML body (optional)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail({ to, subject, text, html }) {
    if (!to || !subject || !text) {
        const errMsg = 'Missing required email fields (to, subject, text).';
        console.warn('[Email]', errMsg);
        return { success: false, error: errMsg };
    }

    const transporter = createTransporter();

    if (transporter) {
        // Real SMTP delivery
        try {
            const info = await transporter.sendMail({
                from: process.env.SMTP_FROM || '"Wingman" <noreply@wingman.app>',
                to,
                subject,
                text,
                html: html || text
            });
            console.log('[Email] Sent via SMTP:', info.messageId, '->', to);
            return { success: true, messageId: info.messageId };
        } catch (err) {
            console.error('[Email] SMTP send failed:', err.message);
            // Fall through to console logging below
        }
    }

    // Console-based fallback (development / no SMTP)
    const divider = '='.repeat(60);
    console.log(`\n${divider}`);
    console.log(`[EMAIL LOG] To: ${to}`);
    console.log(`[EMAIL LOG] Subject: ${subject}`);
    console.log(`[EMAIL LOG] ${divider}`);
    console.log(text);
    if (html) {
        console.log(`[EMAIL LOG] (HTML body omitted — ${html.length} chars)`);
    }
    console.log(`${divider}\n`);

    return { success: true, messageId: `console-${Date.now()}` };
}

/**
 * Send an email verification link to the user.
 *
 * @param {string} to        - Recipient email
 * @param {string} token     - Verification token
 * @param {string} baseUrl   - Application base URL (for constructing the verification link)
 */
async function sendVerificationEmail(to, token, baseUrl) {
    const verifyUrl = `${baseUrl || 'http://localhost:3000'}/api/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;

    return sendEmail({
        to,
        subject: 'Verify your Wingman account email',
        text: `Welcome to Wingman!\n\nPlease verify your email address by clicking the link below:\n\n${verifyUrl}\n\nIf you did not create an account, you can safely ignore this email.\n\n— The Wingman Team`,
        html: `<div style="max-width:480px;margin:40px auto;font-family:Inter,sans-serif;background:#0a0a1a;color:#e2e8f0;padding:32px;border-radius:16px;border:1px solid #2e1a47;">
            <h1 style="color:#a855f7;margin-top:0;">Verify your email</h1>
            <p>Thanks for joining Wingman! Click the link below to verify your email address:</p>
            <p style="text-align:center;margin:28px 0;">
                <a href="${verifyUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email →</a>
            </p>
            <p style="color:#94a3b8;font-size:13px;">If the button doesn't work, copy and paste this URL into your browser:<br/><code style="word-break:break-all;">${verifyUrl}</code></p>
            <hr style="border-color:#1e293b;margin:24px 0;" />
            <p style="color:#64748b;font-size:12px;">If you did not create an account, ignore this email.</p>
        </div>`
    });
}

module.exports = {
    sendEmail,
    sendVerificationEmail
};
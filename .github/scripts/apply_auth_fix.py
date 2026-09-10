from pathlib import Path


def replace_once_text(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Expected source block not found: {label}")
    return text.replace(old, new, 1)


def edit_file(path, editor):
    p = Path(path)
    raw = p.read_bytes()
    had_crlf = b"\r\n" in raw
    original = raw.decode("utf-8").replace("\r\n", "\n")
    updated = editor(original)
    if updated == original:
        raise SystemExit(f"No change made to {path}")
    if had_crlf:
        updated = updated.replace("\n", "\r\n")
    p.write_bytes(updated.encode("utf-8"))


def edit_supabase(text):
    anchor = "    var emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n\n    // 1. Email/Password Signup"
    helper = """    var emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

    // Return only a currently authenticated Supabase session whose user identity is
    // verified by the Auth server. Auth UI decisions must fail closed when this is null.
    window.getCurrentAuthenticatedSession = async function () {
        const client = await initSupabase();
        if (!client || !client.auth) return null;

        try {
            const sessionResp = await client.auth.getSession();
            if (sessionResp && sessionResp.error) return null;
            const session = sessionResp && sessionResp.data ? sessionResp.data.session : null;
            if (!session || !session.user || !isValidToken(session.access_token)) return null;

            const userResp = await client.auth.getUser();
            const verifiedUser = userResp && userResp.data ? userResp.data.user : null;
            if ((userResp && userResp.error) || !verifiedUser || verifiedUser.id !== session.user.id) return null;

            return Object.assign({}, session, { user: verifiedUser });
        } catch (err) {
            console.warn('[SupabaseClient] Auth session verification failed:', err && err.message ? err.message : err);
            return null;
        }
    };

    // 1. Email/Password Signup"""
    text = replace_once_text(text, anchor, helper, "supabase session verifier anchor")
    text = replace_once_text(
        text,
        "return { success: true, user: resp.data.user, session: resp.data.session };",
        "return { success: true, authenticated: true, user: resp.data.user, session: resp.data.session };",
        "signup authenticated return",
    )
    text = replace_once_text(
        text,
        "return { success: true, user: resp.data.user, session: null, confirmationRequired: true };",
        "return { success: true, authenticated: false, user: resp.data.user, session: null, confirmationRequired: true };",
        "signup confirmation-required return",
    )
    text = replace_once_text(
        text,
        "return { success: true, user: resp.data.user, session: resp.data.session, weakPassword: weakPassword };",
        "return { success: true, authenticated: true, user: resp.data.user, session: resp.data.session, weakPassword: weakPassword };",
        "password login authenticated return",
    )
    return text


PRECHECK = """        if (typeof window.getCurrentAuthenticatedSession !== \"function\") {
            if (errBox) {
                errBox.textContent = \"Authentication service is initializing. Please try again.\";
                errBox.classList.remove(\"hidden\");
            }
            return;
        }

        const sessionBeforeAttempt = await window.getCurrentAuthenticatedSession();
        const localSessionBeforeAttempt = window.currentSupabaseSession;
        if ((sessionBeforeAttempt && sessionBeforeAttempt.user && sessionBeforeAttempt.access_token) ||
            (localSessionBeforeAttempt && localSessionBeforeAttempt.user && localSessionBeforeAttempt.access_token)) {
            if (errBox) {
                errBox.textContent = \"You are already signed in. Sign out first to switch accounts.\";
                errBox.classList.remove(\"hidden\");
            }
            return;
        }

"""

CONFIRMATION_AND_GATE = """            if (authResult.confirmationRequired && authResult.authenticated !== true) {
                if (errBox) {
                    errBox.textContent = \"Account created. Check your email to verify it before signing in.\";
                    errBox.classList.remove(\"hidden\");
                }
                return;
            }

            if (!authResult.success || authResult.authenticated !== true || !authResult.user ||
                !authResult.session || !authResult.session.access_token) {"""

VERIFY_BLOCK = """            const verifiedSession = await window.getCurrentAuthenticatedSession();
            if (!verifiedSession || !verifiedSession.user || !verifiedSession.access_token ||
                verifiedSession.user.id !== authResult.user.id) {
                if (errBox) {
                    errBox.textContent = \"Authentication could not be verified. Please sign in again.\";
                    errBox.classList.remove(\"hidden\");
                }
                return;
            }

            window.currentSupabaseSession = verifiedSession;
            window.currentSupabaseUser = verifiedSession.user;
            const verifiedEmail = verifiedSession.user.email || email;

"""


def edit_auth_function(text, start_marker, end_marker, landing=False):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"Function start not found: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"Function end not found: {end_marker}")
    before, region, after = text[:start], text[start:end], text[end:]

    region = replace_once_text(
        region,
        '        if (errBox) errBox.classList.add("hidden");\n\n',
        '        if (errBox) errBox.classList.add("hidden");\n\n' + PRECHECK,
        f"{start_marker} pre-auth session guard",
    )
    region = replace_once_text(
        region,
        "            if (!authResult.success) {",
        CONFIRMATION_AND_GATE,
        f"{start_marker} explicit authenticated gate",
    )

    if landing:
        success_anchor = "                // Close modal and navigate to app.html dashboard\n"
        verification = VERIFY_BLOCK.replace("            ", "                ")
        region = replace_once_text(
            region,
            success_anchor,
            verification + "                // Redirect only after a real Supabase session is independently verified.\n",
            f"{start_marker} fresh-session verification",
        )
        region = replace_once_text(
            region,
            'window.showToast(actionText + email + " 🚀", "success");',
            'window.showToast(actionText + verifiedEmail + " 🚀", "success");',
            f"{start_marker} verified email toast",
        )
    else:
        success_anchor = '            safeStorage.set("wingman_authenticated", "true");\n'
        region = replace_once_text(
            region,
            success_anchor,
            VERIFY_BLOCK + success_anchor,
            f"{start_marker} fresh-session verification",
        )
        region = replace_once_text(
            region,
            'safeStorage.set("wingman_user_email", email);',
            'safeStorage.set("wingman_user_email", verifiedEmail);',
            f"{start_marker} verified email storage",
        )
        region = replace_once_text(
            region,
            'window.showToast(actionText + email + " 🚀", "success");',
            'window.showToast(actionText + verifiedEmail + " 🚀", "success");',
            f"{start_marker} verified email toast",
        )

    return before + region + after


edit_file("supabaseClient.js", edit_supabase)
edit_file(
    "app.js",
    lambda text: edit_auth_function(
        text,
        "    window.handleSupabaseAuthSubmit = async function (e) {",
        "    window.handleDashboardGoogleSignIn = function (e) {",
        landing=False,
    ),
)
edit_file(
    "index.html",
    lambda text: edit_auth_function(
        text,
        "        window.handleSupabaseAuthSubmit = async function (e) {",
        "        window.handlePricingPurchase = function (e, targetUrl) {",
        landing=True,
    ),
)

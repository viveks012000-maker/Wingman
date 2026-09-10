from pathlib import Path
import shutil
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
INDEX = REPO_ROOT / "index.html"
DIST = REPO_ROOT / "netlify-dist"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "cleanup-auth-pr.yml"
SELF = Path(__file__).resolve()


def run(*args):
    subprocess.run(args, cwd=REPO_ROOT, check=True)


def restore_from_main():
    if DIST.exists():
        shutil.rmtree(DIST)
    run("git", "checkout", "origin/main", "--", "index.html")


def patch_index_handler():
    data = INDEX.read_bytes()
    start_marker = b'        window.handleSupabaseAuthSubmit = async function (e) {'
    end_marker = b'        window.handlePricingPurchase = function (e, targetUrl) {'
    start = data.find(start_marker)
    end = data.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0:
        raise RuntimeError("Could not locate canonical landing-page auth handler boundaries")

    original = data[start:end]
    newline = "\r\n" if original.count(b"\r\n") >= max(1, original.count(b"\n") // 2) else "\n"
    handler = r'''        window.handleSupabaseAuthSubmit = async function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (authSubmitInFlight) return false;

            const emailInput = $("authEmailInput");
            const passwordInput = $("authPasswordInput");
            const submitBtn = $("authSubmitBtn");
            const email = (emailInput && emailInput.value) ? emailInput.value.trim().toLowerCase() : "";
            const password = (passwordInput && passwordInput.value) ? passwordInput.value : "";
            const errBox = $("authErrorMessage");

            if (errBox) errBox.classList.add("hidden");

            if (typeof window.getCurrentAuthenticatedSession !== "function") {
                if (errBox) {
                    errBox.textContent = "Authentication service is initializing. Please try again.";
                    errBox.classList.remove("hidden");
                }
                return;
            }

            const sessionBeforeAttempt = await window.getCurrentAuthenticatedSession();
            const localSessionBeforeAttempt = window.currentSupabaseSession;
            if ((sessionBeforeAttempt && sessionBeforeAttempt.user && sessionBeforeAttempt.access_token) ||
                (localSessionBeforeAttempt && localSessionBeforeAttempt.user && localSessionBeforeAttempt.access_token)) {
                if (errBox) {
                    errBox.textContent = "You are already signed in. Sign out first to switch accounts.";
                    errBox.classList.remove("hidden");
                }
                return;
            }

            // STRICT VALIDATION: EMAIL AND PASSWORD ARE MANDATORY
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

            // Domain 5: Bot Defense Honeypot Check
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

            authSubmitInFlight = true;
            const originalBtnText = submitBtn ? submitBtn.textContent : "";
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add("opacity-70", "cursor-not-allowed");
                submitBtn.textContent = window.isSignupMode ? "Creating Account..." : "Signing In...";
            }

            try {
                let authResult = { success: false, error: 'Authentication service unavailable.' };

                if (typeof window.signUpUser === 'function' && window.isSignupMode) {
                    authResult = await window.signUpUser(email, password);
                } else if (typeof window.loginUser === 'function') {
                    authResult = await window.loginUser(email, password);
                }

                if (authResult.confirmationRequired && authResult.authenticated !== true) {
                    if (errBox) {
                        errBox.textContent = "Account created. Check your email to verify it before signing in.";
                        errBox.classList.remove("hidden");
                    }
                    return;
                }

                if (!authResult.success || authResult.authenticated !== true || !authResult.user ||
                    !authResult.session || !authResult.session.access_token) {
                    if (errBox) {
                        errBox.textContent = authResult.error || "Authentication failed. Please check your credentials.";
                        errBox.classList.remove("hidden");
                    }
                    return;
                }

                const verifiedSession = await window.getCurrentAuthenticatedSession();
                if (!verifiedSession || !verifiedSession.user || !verifiedSession.access_token ||
                    verifiedSession.user.id !== authResult.user.id) {
                    if (errBox) {
                        errBox.textContent = "Authentication could not be verified. Please sign in again.";
                        errBox.classList.remove("hidden");
                    }
                    return;
                }

                window.currentSupabaseSession = verifiedSession;
                window.currentSupabaseUser = verifiedSession.user;
                const verifiedEmail = verifiedSession.user.email || email;

                // Redirect only after a real Supabase session is independently verified.
                window.closeAuthRequiredModal();
                if (typeof window.showToast === "function") {
                    const actionText = window.isSignupMode ? "Account created as " : "Signed in as ";
                    window.showToast(actionText + verifiedEmail + " 🚀", "success");
                }

                window.location.href = "app.html";
            } finally {
                authSubmitInFlight = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.classList.remove("opacity-70", "cursor-not-allowed");
                    submitBtn.textContent = originalBtnText || (window.isSignupMode ? "Sign Up with Email" : "Sign In with Email");
                }
            }
        };

'''
    replacement = handler.replace("\n", newline).encode("utf-8")
    INDEX.write_bytes(data[:start] + replacement + data[end:])


def finalize():
    if DIST.exists():
        shutil.rmtree(DIST)
    if WORKFLOW.exists():
        WORKFLOW.unlink()
    if SELF.exists():
        SELF.unlink()

    output = subprocess.check_output(["git", "diff", "--name-only", "origin/main"], cwd=REPO_ROOT, text=True)
    changed = sorted(line.strip() for line in output.splitlines() if line.strip())
    expected = sorted([
        "app.js",
        "index.html",
        "package.json",
        "supabaseClient.js",
        "tests/auth_fail_closed_signup.test.js",
    ])
    print("Final PR files:")
    print("\n".join(changed))
    if changed != expected:
        raise RuntimeError(f"Unexpected final diff. Expected {expected}, got {changed}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "prepare":
        restore_from_main()
        patch_index_handler()
    elif mode == "finalize":
        finalize()
    else:
        raise SystemExit("usage: clean_auth_pr.py [prepare|finalize]")

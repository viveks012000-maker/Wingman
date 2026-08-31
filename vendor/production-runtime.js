(function () {
    'use strict';

    var runtimeInstalled = false;
    var reviewBusy = false;

    function byId(id) {
        return document.getElementById(id);
    }

    function notify(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type || 'info');
            return;
        }
        if (type === 'error') console.error(message);
        else console.log(message);
    }

    function apiBase() {
        if (typeof window.getApiBase === 'function') return window.getApiBase() || '';
        return (window.WINGMAN_CONFIG && window.WINGMAN_CONFIG.API_BASE_URL) || '';
    }

    async function authHeaders() {
        if (typeof window.getSupabaseAuthHeaders !== 'function') return {};
        var headers = await window.getSupabaseAuthHeaders();
        return headers && typeof headers === 'object' ? headers : {};
    }

    function clearOwnedStorage() {
        [window.localStorage, window.sessionStorage].forEach(function (storage) {
            if (!storage) return;
            for (var i = storage.length - 1; i >= 0; i -= 1) {
                var key = storage.key(i);
                if (key && key.indexOf('wingman_') === 0) storage.removeItem(key);
            }
        });
    }

    function makeButton(text) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.style.cssText = 'border:1px solid rgba(168,85,247,.55);background:rgba(91,33,182,.28);color:#e9d5ff;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;transition:opacity .2s ease,transform .2s ease;';
        return button;
    }

    // ---------------------------------------------------------------------
    // Landing forgot-password resilience. Source already has this feature;
    // this fallback only activates if the page-level handler is unavailable.
    // ---------------------------------------------------------------------
    function installForgotPasswordFallback() {
        if (typeof window.showForgotPasswordView !== 'function') {
            window.showForgotPasswordView = function () {
                var form = byId('supabaseAuthForm');
                var view = byId('forgotPasswordView');
                var toggle = byId('authToggleContainer');
                if (form) form.classList.add('hidden');
                if (view) view.classList.remove('hidden');
                if (toggle) toggle.classList.add('hidden');
                var title = byId('authModalTitle');
                var desc = byId('authModalDesc');
                if (title) title.textContent = 'Reset Your Password';
                if (desc) desc.textContent = "Enter your email and we'll send you a secure password reset link.";
                var sourceEmail = byId('authEmailInput');
                var targetEmail = byId('resetEmailInput');
                if (sourceEmail && targetEmail && sourceEmail.value) targetEmail.value = sourceEmail.value;
                if (targetEmail) targetEmail.focus();
            };
        }

        var button = byId('forgotPasswordBtn');
        if (button && !button.__wingmanRecoveryGuard) {
            button.__wingmanRecoveryGuard = true;
            button.addEventListener('click', function () {
                setTimeout(function () {
                    var view = byId('forgotPasswordView');
                    if (view && view.classList.contains('hidden') && typeof window.showForgotPasswordView === 'function') {
                        window.showForgotPasswordView();
                    }
                }, 0);
            });
        }
    }

    // ---------------------------------------------------------------------
    // Authenticated self-service account deletion.
    // ---------------------------------------------------------------------
    function installAccountDeletionRepair() {
        if (!byId('confirmDeleteAccountBtn')) return;

        window.confirmPermanentDeletion = async function (event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            var button = byId('confirmDeleteAccountBtn');
            if (button) {
                button.disabled = true;
                button.textContent = 'Deleting account…';
            }

            try {
                var headers = await authHeaders();
                if (!headers.Authorization) {
                    throw new Error('Your authenticated session could not be verified. Please sign in again before deleting your account.');
                }

                var response = await fetch(apiBase() + '/api/user/delete-account', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
                    credentials: 'include'
                });
                var data = await response.json().catch(function () { return {}; });
                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Account deletion failed on the server.');
                }

                try {
                    if (window.supabaseClient && window.supabaseClient.auth) await window.supabaseClient.auth.signOut();
                } catch (_) {}
                try { clearOwnedStorage(); } catch (_) {}
                try { if (typeof window.closeDeleteAccountModal === 'function') window.closeDeleteAccountModal(); } catch (_) {}
                notify('Your MyWingman account and associated data were permanently deleted.', 'warning');
                setTimeout(function () { window.location.href = '/'; }, 700);
            } catch (err) {
                console.error('[Delete Account Error]:', err);
                notify((err && err.message) || 'Failed to delete account. Please try again.', 'error');
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Delete Permanently';
                }
            }
        };
    }

    // ---------------------------------------------------------------------
    // Simulator session review UI + real backend call.
    // ---------------------------------------------------------------------
    function collectSimulatorTranscript() {
        var messages = [];
        var container = byId('chatbox-messages-container');
        if (container) {
            Array.prototype.forEach.call(container.querySelectorAll('.animate-chat-bubble'), function (bubble) {
                var align = bubble.style.alignSelf || '';
                var role = align === 'flex-end' ? 'user' : (align === 'flex-start' ? 'assistant' : null);
                if (!role) return;
                var text = (bubble.textContent || '').trim();
                if (!text || text === 'Typing...') return;
                messages.push({ role: role, content: text });
            });
        }

        if (messages.length >= 2) return messages.slice(-50);

        ['sessionStorage', 'localStorage'].some(function (storageName) {
            try {
                var storage = window[storageName];
                var raw = storage && storage.getItem('wingman_session_data');
                if (!raw) return false;
                var parsed = JSON.parse(raw);
                var thread = parsed && Array.isArray(parsed.activeSimulatorThread) ? parsed.activeSimulatorThread : [];
                var restored = thread.filter(function (item) {
                    return item && (item.role === 'user' || item.role === 'assistant') && (item.content || item.text);
                }).map(function (item) {
                    return { role: item.role, content: String(item.content || item.text) };
                });
                if (restored.length >= 2) {
                    messages = restored.slice(-50);
                    return true;
                }
            } catch (_) {}
            return false;
        });

        return messages;
    }

    function ensureReviewModal() {
        var existing = byId('simulatorReviewModal');
        if (existing) return existing;

        var overlay = document.createElement('div');
        overlay.id = 'simulatorReviewModal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'simulatorReviewTitle');
        overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);backdrop-filter:blur(10px);align-items:center;justify-content:center;padding:18px;overflow:auto;';

        var card = document.createElement('div');
        card.style.cssText = 'width:min(100%,620px);max-height:90vh;overflow:auto;background:#0d0918;border:1px solid rgba(168,85,247,.45);border-radius:18px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.65);color:#fff;font-family:Inter,system-ui,sans-serif;';

        var top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:15px;';
        var titleWrap = document.createElement('div');
        var title = document.createElement('h2');
        title.id = 'simulatorReviewTitle';
        title.textContent = 'Conversation Review';
        title.style.cssText = 'margin:0;font-size:21px;font-weight:800;';
        var status = document.createElement('div');
        status.id = 'simulatorReviewStatus';
        status.style.cssText = 'margin-top:5px;color:#c4b5fd;font-size:12px;font-weight:700;';
        titleWrap.appendChild(title);
        titleWrap.appendChild(status);
        var close = makeButton('Close');
        close.id = 'simulatorReviewClose';
        close.setAttribute('aria-label', 'Close conversation review dialog');
        close.style.padding = '7px 10px';
        close.addEventListener('click', function () { window.closeSessionReviewModal(); });
        top.appendChild(titleWrap);
        top.appendChild(close);

        var score = document.createElement('div');
        score.id = 'simulatorReviewScore';
        score.style.cssText = 'font-size:38px;font-weight:900;color:#c084fc;margin:6px 0 16px;';

        var metrics = document.createElement('div');
        metrics.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px;';
        ['wit_score', 'text_economy', 'confidence_score'].forEach(function (key) {
            var box = document.createElement('div');
            box.style.cssText = 'background:#120d20;border:1px solid #2e1a47;border-radius:10px;padding:10px;text-align:center;';
            var label = document.createElement('div');
            label.textContent = key === 'wit_score' ? 'Wit' : (key === 'text_economy' ? 'Text Economy' : 'Confidence');
            label.style.cssText = 'font-size:10px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;';
            var value = document.createElement('div');
            value.id = 'review-' + key;
            value.textContent = '—';
            value.style.cssText = 'font-size:18px;font-weight:800;color:#fff;';
            box.appendChild(label);
            box.appendChild(value);
            metrics.appendChild(box);
        });

        var fields = [
            ['performance_summary', 'Performance Summary'],
            ['biggest_strength', 'Biggest Strength'],
            ['biggest_mistake', 'Biggest Mistake'],
            ['priority_focus', 'Priority Focus']
        ];
        var detailWrap = document.createElement('div');
        fields.forEach(function (pair) {
            var section = document.createElement('section');
            section.style.cssText = 'margin-top:12px;background:#0a0712;border:1px solid #2e1a47;border-radius:10px;padding:12px;';
            var heading = document.createElement('h3');
            heading.textContent = pair[1];
            heading.style.cssText = 'margin:0 0 5px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#a78bfa;';
            var value = document.createElement('p');
            value.id = 'review-' + pair[0];
            value.textContent = '—';
            value.style.cssText = 'margin:0;color:#e2e8f0;font-size:13px;line-height:1.5;white-space:pre-wrap;';
            section.appendChild(heading);
            section.appendChild(value);
            detailWrap.appendChild(section);
        });

        card.appendChild(top);
        card.appendChild(score);
        card.appendChild(metrics);
        card.appendChild(detailWrap);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        if (typeof window.registerWingmanModal === 'function') {
            window.registerWingmanModal('simulatorReviewModal', { close: 'closeSessionReviewModal', label: 'Conversation review' });
        }

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) window.closeSessionReviewModal();
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') window.closeSessionReviewModal();
        });
        return overlay;
    }

    function renderReview(data) {
        ensureReviewModal();
        var score = byId('simulatorReviewScore');
        var status = byId('simulatorReviewStatus');
        if (score) score.textContent = String(data.overall_score) + ' / 100';
        if (status) status.textContent = data.status_text || 'REVIEW COMPLETE';
        ['wit_score', 'text_economy', 'confidence_score', 'performance_summary', 'biggest_strength', 'biggest_mistake', 'priority_focus'].forEach(function (key) {
            var el = byId('review-' + key);
            if (el) el.textContent = data[key] == null ? '—' : String(data[key]);
        });
    }

    window.closeSessionReviewModal = function () {
        var modal = byId('simulatorReviewModal');
        if (!modal) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    };

    window.triggerFinishAndReview = async function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (reviewBusy) return;

        var history = collectSimulatorTranscript();
        if (history.length < 2) {
            notify('Send at least one message and receive a reply before requesting a conversation review.', 'warning');
            return;
        }

        reviewBusy = true;
        var button = byId('simulatorReviewBtn');
        if (button) {
            button.disabled = true;
            button.textContent = 'Reviewing…';
            button.style.opacity = '.55';
        }

        try {
            var headers = await authHeaders();
            if (!headers.Authorization) throw new Error('Please sign in before requesting a conversation review.');
            var requestId = 'review_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            var response = await fetch(apiBase() + '/api/simulator/review', {
                method: 'POST',
                headers: Object.assign({
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': requestId
                }, headers),
                credentials: 'include',
                body: JSON.stringify({ sessionHistory: history, idempotencyKey: requestId })
            });
            var data = await response.json().catch(function () { return {}; });

            if (!response.ok || !data.success) {
                if (response.status === 402 && typeof window.checkCreditBalance === 'function') {
                    try { await window.checkCreditBalance(); } catch (_) {}
                }
                throw new Error(data.error || ('Conversation review failed with HTTP ' + response.status + '.'));
            }

            if (typeof data.credits === 'number' && typeof window.updateUICredits === 'function') {
                window.updateUICredits(data.credits);
            }
            renderReview(data);
            var modal = ensureReviewModal();
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
            var close = byId('simulatorReviewClose');
            if (close) setTimeout(function () { close.focus(); }, 0);
            notify('Conversation review complete. 2 credits processed.', 'success');
        } catch (err) {
            console.error('[Simulator Review Error]:', err);
            notify((err && err.message) || 'Conversation review failed. Your credits should remain protected by the server ledger.', 'error');
        } finally {
            reviewBusy = false;
            if (button) {
                button.disabled = false;
                button.textContent = 'Finish & Review · 2 Credits';
                button.style.opacity = '1';
            }
        }
    };

    window.openHolisticReviewModal = function (event) {
        return window.triggerFinishAndReview(event);
    };

    function installSimulatorReviewButton() {
        if (!byId('chatbox-messages-container') || byId('simulatorReviewBtn')) return;
        var footer = document.querySelector('.chatbox-footer-sticky-wrapper');
        var creditNotice = byId('chatbox-credit-notice');
        if (!footer || !creditNotice) return;

        var row = document.createElement('div');
        row.id = 'simulatorReviewActionRow';
        row.style.cssText = 'padding:0 12px 8px;display:flex;justify-content:flex-end;';
        var button = makeButton('Finish & Review · 2 Credits');
        button.id = 'simulatorReviewBtn';
        button.setAttribute('aria-label', 'Finish conversation and generate a two-credit performance review');
        button.addEventListener('click', window.triggerFinishAndReview);
        row.appendChild(button);
        footer.insertBefore(row, creditNotice);
    }

    function installRuntime() {
        if (runtimeInstalled) return;
        runtimeInstalled = true;
        installForgotPasswordFallback();
        installAccountDeletionRepair();
        installSimulatorReviewButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installRuntime, { once: true });
    } else {
        installRuntime();
    }

    window.addEventListener('load', function () {
        installForgotPasswordFallback();
        installAccountDeletionRepair();
        installSimulatorReviewButton();
    }, { once: true });
})();

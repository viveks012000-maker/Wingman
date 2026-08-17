(function () {
    'use strict';

    var REAL_SCRIPT_SRC = './vendor/heic2any.min.js';
    var loadPromise = null;

    function loadHeicConverter() {
        if (typeof window.heic2any === 'function' && window.heic2any !== lazyHeic2Any) {
            return Promise.resolve(window.heic2any);
        }
        if (loadPromise) return loadPromise;

        loadPromise = new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-wingman-heic-runtime]');
            if (existing) {
                existing.addEventListener('load', finish, { once: true });
                existing.addEventListener('error', fail, { once: true });
                return;
            }

            var script = document.createElement('script');
            script.src = REAL_SCRIPT_SRC;
            script.async = true;
            script.setAttribute('data-wingman-heic-runtime', 'true');
            script.addEventListener('load', finish, { once: true });
            script.addEventListener('error', fail, { once: true });
            document.head.appendChild(script);

            function finish() {
                var implementation = window.heic2any;
                if (typeof implementation !== 'function' || implementation === lazyHeic2Any) {
                    fail(new Error('HEIC converter loaded without exposing its runtime API.'));
                    return;
                }
                resolve(implementation);
            }

            function fail(error) {
                loadPromise = null;
                window.heic2any = lazyHeic2Any;
                reject(error instanceof Error ? error : new Error('Failed to load HEIC converter.'));
            }
        });

        return loadPromise;
    }

    async function lazyHeic2Any(options) {
        var implementation = await loadHeicConverter();
        return implementation(options);
    }

    // Keep app.js unchanged: its existing HEIC path already awaits window.heic2any(...).
    // JPEG/PNG users therefore never fetch the 1+ MB converter, while HEIC/HEIF users
    // retain exactly the same conversion API and error handling.
    window.heic2any = lazyHeic2Any;
    window.__wingmanLoadHeicConverter = loadHeicConverter;
})();

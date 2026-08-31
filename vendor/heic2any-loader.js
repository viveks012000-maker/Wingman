(function () {
    'use strict';

    var REAL_SRC = './vendor/heic2any-adapter.js';
    var loadPromise = null;

    function getRealImplementation(lazyFn) {
        return (typeof window.heic2any === 'function' && window.heic2any !== lazyFn)
            ? window.heic2any
            : null;
    }

    function removeLoaderScript() {
        var stale = document.querySelector('script[data-wingman-heic-runtime]');
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    }

    function loadRealImplementation(lazyFn) {
        var existing = getRealImplementation(lazyFn);
        if (existing) return Promise.resolve(existing);
        if (loadPromise) return loadPromise;

        loadPromise = new Promise(function (resolve, reject) {
            removeLoaderScript();

            var script = document.createElement('script');
            script.src = REAL_SRC;
            script.type = 'module';
            script.async = true;
            script.setAttribute('data-wingman-heic-runtime', 'true');

            script.onload = function () {
                var implementation = getRealImplementation(lazyFn);
                if (!implementation) {
                    removeLoaderScript();
                    reject(new Error('HEIC converter loaded without exposing its runtime.'));
                    return;
                }
                resolve(implementation);
            };

            script.onerror = function () {
                removeLoaderScript();
                reject(new Error('HEIC converter failed to load.'));
            };

            document.head.appendChild(script);
        }).catch(function (error) {
            loadPromise = null;
            throw error;
        });

        return loadPromise;
    }

    async function lazyHeic2Any(options) {
        try {
            var implementation = await loadRealImplementation(lazyHeic2Any);
            return await implementation(options);
        } catch (error) {
            if (typeof window.showToast === 'function') {
                window.showToast('HEIC conversion could not start. Please retry or use JPEG/PNG.', 'error');
            }
            throw error;
        }
    }

    // Preserve an already-loaded real implementation if this loader is accidentally executed twice.
    if (typeof window.heic2any !== 'function') {
        window.heic2any = lazyHeic2Any;
    }
})();

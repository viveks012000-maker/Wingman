(function () {
    'use strict';

    var REAL_SRC = '/vendor/heic-runtime/heic-to-csp.js';
    var loadPromise = null;
    var implementation = null;

    function loadRealImplementation() {
        if (implementation) return Promise.resolve(implementation);
        if (loadPromise) return loadPromise;

        loadPromise = import(REAL_SRC).then(function (mod) {
            implementation = mod.heicTo || mod.heic2any || mod.default;
            if (typeof implementation !== 'function') {
                throw new Error('HEIC converter module does not export a heicTo/heic2any function.');
            }
            return implementation;
        }).catch(function (error) {
            loadPromise = null;
            throw error;
        });

        return loadPromise;
    }

    async function lazyHeic2Any(options) {
        try {
            var impl = await loadRealImplementation();
            return await impl(options);
        } catch (error) {
            if (typeof window.showToast === 'function') {
                window.showToast('HEIC conversion could not start. Please retry or use JPEG/PNG.', 'error');
            }
            throw error;
        }
    }

    if (typeof window.heic2any !== 'function') {
        window.heic2any = lazyHeic2Any;
    }
})();
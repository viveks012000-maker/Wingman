import { heicTo } from './heic-runtime/heic-to-csp.js';

window.heic2any = async function (options) {
    if (!options || !options.blob || !options.type) {
        throw new TypeError('HEIC conversion requires a blob and output type.');
    }

    return heicTo({
        blob: options.blob,
        type: options.type,
        quality: options.quality
    });
};

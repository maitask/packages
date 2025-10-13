/**
 * @maitask/image-metadata
 * Image metadata extraction from file headers
 *
 * Features:
 * - PNG, JPEG, GIF, BMP, WebP format detection
 * - Dimensions extraction
 * - Color depth and type
 * - File size analysis
 * - Basic EXIF data (JPEG)
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input image data (base64 or binary)
 * @param {Object} options - Extraction options
 * @param {Object} context - Execution context
 * @returns {Object} Image metadata
 */
function execute(input, options = {}, context = {}) {
    try {
        const bytes = ensureBytes(input);
        const metadata = extractMetadata(bytes);

        return {
            success: true,
            ...metadata,
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Metadata extraction error',
                code: 'METADATA_ERROR',
                type: error.constructor.name
            },
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

/**
 * Ensure input is byte array
 */
function ensureBytes(input) {
    if (input instanceof Uint8Array || Array.isArray(input)) {
        return Array.from(input);
    }

    if (typeof input === 'string') {
        return base64ToBytes(input);
    }

    if (input && typeof input.base64 === 'string') {
        return base64ToBytes(input.base64);
    }

    if (input && input.data && Array.isArray(input.data)) {
        return input.data;
    }

    throw new Error('Invalid input: expected base64 string or byte array');
}

/**
 * Convert base64 to bytes
 */
function base64ToBytes(base64) {
    const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
    const bytes = [];

    for (let i = 0; i < clean.length; i += 4) {
        const enc1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.indexOf(clean[i]);
        const enc2 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.indexOf(clean[i + 1]);
        const enc3 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.indexOf(clean[i + 2]);
        const enc4 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.indexOf(clean[i + 3]);

        const chr1 = (enc1 << 2) | (enc2 >> 4);
        const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        const chr3 = ((enc3 & 3) << 6) | enc4;

        bytes.push(chr1);
        if (enc3 !== 64) bytes.push(chr2);
        if (enc4 !== 64) bytes.push(chr3);
    }

    return bytes;
}

/**
 * Extract metadata from image bytes
 */
function extractMetadata(bytes) {
    const format = detectFormat(bytes);

    if (!format) {
        throw new Error('Unknown or unsupported image format');
    }

    let dimensions = null;
    let colorInfo = null;
    let exif = null;

    switch (format) {
        case 'PNG':
            dimensions = extractPngDimensions(bytes);
            colorInfo = extractPngColorInfo(bytes);
            break;
        case 'JPEG':
            dimensions = extractJpegDimensions(bytes);
            exif = extractBasicExif(bytes);
            break;
        case 'GIF':
            dimensions = extractGifDimensions(bytes);
            break;
        case 'BMP':
            dimensions = extractBmpDimensions(bytes);
            colorInfo = extractBmpColorInfo(bytes);
            break;
        case 'WebP':
            dimensions = extractWebPDimensions(bytes);
            break;
    }

    return {
        format,
        fileSize: bytes.length,
        dimensions,
        colorInfo,
        exif
    };
}

/**
 * Detect image format from magic bytes
 */
function detectFormat(bytes) {
    if (bytes.length < 8) return null;

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'PNG';
    }

    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'JPEG';
    }

    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        return 'GIF';
    }

    if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
        return 'BMP';
    }

    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'WebP';
    }

    return null;
}

/**
 * Extract PNG dimensions
 */
function extractPngDimensions(bytes) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];

    return { width, height };
}

/**
 * Extract PNG color info
 */
function extractPngColorInfo(bytes) {
    const bitDepth = bytes[24];
    const colorType = bytes[25];

    const colorTypes = {
        0: 'Grayscale',
        2: 'RGB',
        3: 'Indexed',
        4: 'Grayscale + Alpha',
        6: 'RGBA'
    };

    return {
        bitDepth,
        colorType: colorTypes[colorType] || 'Unknown'
    };
}

/**
 * Extract JPEG dimensions
 */
function extractJpegDimensions(bytes) {
    let i = 2;

    while (i < bytes.length - 8) {
        if (bytes[i] !== 0xFF) break;

        const marker = bytes[i + 1];

        if (marker === 0xC0 || marker === 0xC2) {
            const height = (bytes[i + 5] << 8) | bytes[i + 6];
            const width = (bytes[i + 7] << 8) | bytes[i + 8];
            return { width, height };
        }

        const segmentLength = (bytes[i + 2] << 8) | bytes[i + 3];
        i += 2 + segmentLength;
    }

    return null;
}

/**
 * Extract basic EXIF from JPEG
 */
function extractBasicExif(bytes) {
    for (let i = 0; i < bytes.length - 10; i++) {
        if (bytes[i] === 0xFF && bytes[i + 1] === 0xE1) {
            if (bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 &&
                bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
                return { hasExif: true };
            }
        }
    }

    return { hasExif: false };
}

/**
 * Extract GIF dimensions
 */
function extractGifDimensions(bytes) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);

    return { width, height };
}

/**
 * Extract BMP dimensions
 */
function extractBmpDimensions(bytes) {
    const width = bytes[18] | (bytes[19] << 8) | (bytes[20] << 16) | (bytes[21] << 24);
    const height = bytes[22] | (bytes[23] << 8) | (bytes[24] << 16) | (bytes[25] << 24);

    return { width, height: Math.abs(height) };
}

/**
 * Extract BMP color info
 */
function extractBmpColorInfo(bytes) {
    const bitDepth = bytes[28] | (bytes[29] << 8);

    return {
        bitDepth,
        colorType: bitDepth <= 8 ? 'Indexed' : 'RGB'
    };
}

/**
 * Extract WebP dimensions
 */
function extractWebPDimensions(bytes) {
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38) {
        if (bytes[15] === 0x20) {
            const width = ((bytes[26] | (bytes[27] << 8) | (bytes[28] << 16)) & 0x3FFF) + 1;
            const height = ((bytes[29] | (bytes[30] << 8) | (bytes[31] << 16)) & 0x3FFF) + 1;
            return { width, height };
        }

        if (bytes[15] === 0x4C) {
            const width = ((bytes[21] | (bytes[22] << 8) | (bytes[23] << 16)) & 0x3FFF) + 1;
            const height = ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0x3FFF) + 1;
            return { width, height };
        }
    }

    return null;
}

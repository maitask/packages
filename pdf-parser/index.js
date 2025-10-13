/**
 * @maitask/pdf-parser
 * High-performance PDF parser and text extractor
 *
 * Features:
 * - PDF text extraction with structure preservation
 * - Metadata extraction (title, author, creation date, pages)
 * - UTF-8 and Base64 support
 * - Page estimation and content analysis
 * - Comprehensive error handling
 * - Text segmentation and filtering
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/**
 * Main execution function for PDF parsing
 * @param {Object} input - Input data with text or base64 content
 * @param {Object} options - Parsing options
 * @param {Object} context - Execution context
 * @returns {Object} Parsed PDF data with text and metadata
 */
function execute(input, options = {}, context = {}) {
    try {
        const config = buildParsingConfig(options);
        const bytes = extractBytesFromInput(input);

        if (!bytes || bytes.length === 0) {
            return createEmptyResponse(input);
        }

        // Convert bytes to ASCII text for PDF parsing
        const rawText = bytesToAscii(bytes);
        const cleanText = preprocessText(rawText, config);

        // Extract PDF metadata
        const metadata = extractPdfMetadata(rawText, input);

        // Extract and filter text segments
        const segments = extractTextSegments(cleanText, config);
        const filteredSegments = filterSegments(segments, config);

        // Generate preview text
        const previewText = generatePreviewText(filteredSegments, config);

        return {
            success: true,
            parser: 'pdf',
            fileType: 'pdf',
            text: previewText,
            segments: filteredSegments.slice(0, config.maxSegments),
            pages: metadata.estimatedPages,
            statistics: {
                totalSegments: segments.length,
                filteredSegments: filteredSegments.length,
                estimatedPages: metadata.estimatedPages || 0,
                textLength: previewText.length,
                hasMetadata: !!(metadata.title || metadata.author || metadata.subject),
                preview: filteredSegments.slice(0, 5)
            },
            metadata: {
                path: input?.path || null,
                size: input?.size || null,
                extension: input?.extension || 'pdf',
                encoding: 'binary-to-ascii',
                mimeType: 'application/pdf',
                title: metadata.title,
                author: metadata.author,
                subject: metadata.subject,
                creator: metadata.creator,
                producer: metadata.producer,
                creationDate: metadata.creationDate,
                modificationDate: metadata.modificationDate,
                estimatedPages: metadata.estimatedPages,
                parsedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown PDF parsing error',
                code: 'PDF_PARSE_ERROR',
                type: 'PdfParsingError',
                details: error.details || null
            },
            metadata: {
                parsedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

/**
 * Build parsing configuration from options
 */
function buildParsingConfig(options) {
    return {
        maxSegments: options.maxSegments || 200,
        maxPreviewLength: options.maxPreviewLength || 12000,
        minSegmentLength: options.minSegmentLength || 4,
        excludeShortWords: options.excludeShortWords !== false,
        preserveFormatting: options.preserveFormatting === true,
        extractImages: options.extractImages === true,
        extractLinks: options.extractLinks === true
    };
}

/**
 * Create empty response for no input
 */
function createEmptyResponse(input) {
    return {
        success: true,
        parser: 'pdf',
        fileType: 'pdf',
        text: '',
        segments: [],
        pages: 0,
        statistics: {
            totalSegments: 0,
            filteredSegments: 0,
            estimatedPages: 0,
            textLength: 0,
            hasMetadata: false,
            preview: []
        },
        metadata: {
            path: input?.path || null,
            size: input?.size || null,
            extension: input?.extension || 'pdf',
            encoding: 'binary-to-ascii',
            mimeType: 'application/pdf',
            estimatedPages: 0,
            parsedAt: new Date().toISOString(),
            version: '0.1.0'
        }
    };
}

/**
 * Extract bytes from various input formats
 */
function extractBytesFromInput(input) {
    if (!input) {
        return [];
    }

    // Base64 encoded content
    if (typeof input.base64 === 'string' && input.base64.length > 0) {
        try {
            return decodeBase64ToBytes(input.base64);
        } catch (error) {
            throw new Error(`Base64 decoding failed: ${error.message}`);
        }
    }

    // Direct text content (treat as binary string)
    if (typeof input.text === 'string') {
        return input.text.split('').map(ch => ch.charCodeAt(0) & 0xff);
    }

    // Handle string input directly
    if (typeof input === 'string') {
        return input.split('').map(ch => ch.charCodeAt(0) & 0xff);
    }

    return [];
}

/**
 * Extract PDF metadata from raw text
 */
function extractPdfMetadata(text, input) {
    const metadata = {};

    // Estimate page count
    metadata.estimatedPages = estimatePageCount(text);

    // Extract title
    const titleMatch = text.match(/\/Title\s*\(([^)]+)\)/);
    if (titleMatch && titleMatch[1]) {
        metadata.title = cleanMetadataString(titleMatch[1]);
    }

    // Extract author
    const authorMatch = text.match(/\/Author\s*\(([^)]+)\)/);
    if (authorMatch && authorMatch[1]) {
        metadata.author = cleanMetadataString(authorMatch[1]);
    }

    // Extract subject
    const subjectMatch = text.match(/\/Subject\s*\(([^)]+)\)/);
    if (subjectMatch && subjectMatch[1]) {
        metadata.subject = cleanMetadataString(subjectMatch[1]);
    }

    // Extract creator
    const creatorMatch = text.match(/\/Creator\s*\(([^)]+)\)/);
    if (creatorMatch && creatorMatch[1]) {
        metadata.creator = cleanMetadataString(creatorMatch[1]);
    }

    // Extract producer
    const producerMatch = text.match(/\/Producer\s*\(([^)]+)\)/);
    if (producerMatch && producerMatch[1]) {
        metadata.producer = cleanMetadataString(producerMatch[1]);
    }

    // Extract creation date
    const creationDateMatch = text.match(/\/CreationDate\s*\(([^)]+)\)/);
    if (creationDateMatch && creationDateMatch[1]) {
        metadata.creationDate = parseePdfDate(creationDateMatch[1]);
    }

    // Extract modification date
    const modDateMatch = text.match(/\/ModDate\s*\(([^)]+)\)/);
    if (modDateMatch && modDateMatch[1]) {
        metadata.modificationDate = parseePdfDate(modDateMatch[1]);
    }

    return metadata;
}

/**
 * Estimate page count from PDF content
 */
function estimatePageCount(text) {
    // Look for /Type /Page objects
    const pageMatches = text.match(/\/Type\s*\/Page\b/gi);
    if (pageMatches && pageMatches.length > 0) {
        return pageMatches.length;
    }

    // Fall back to form feed characters
    const formFeeds = text.split('\f').length - 1;
    if (formFeeds > 0) {
        return formFeeds;
    }

    // Estimate based on content length (rough heuristic)
    if (text.length > 50000) {
        return Math.ceil(text.length / 50000);
    }

    return 1;
}

/**
 * Clean metadata strings by removing PDF encoding artifacts
 */
function cleanMetadataString(str) {
    if (!str) return '';

    return str
        .replace(/\\[0-7]{3}/g, '') // Remove octal escapes
        .replace(/\\[rnt]/g, ' ')   // Replace escaped chars with space
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();
}

/**
 * Parse PDF date format (D:YYYYMMDDHHmmSSOHH'mm')
 */
function parseePdfDate(dateStr) {
    if (!dateStr) return null;

    // Remove D: prefix if present
    const clean = dateStr.replace(/^D:/, '');

    // Try to parse as ISO date first
    if (clean.includes('-') || clean.includes('T')) {
        const date = new Date(clean);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }
    }

    // Parse PDF date format: YYYYMMDDHHMMSS
    const match = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (match) {
        const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
        try {
            const date = new Date(
                parseInt(year),
                parseInt(month) - 1, // Month is 0-based
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );
            return date.toISOString();
        } catch (e) {
            return null;
        }
    }

    return null;
}

/**
 * Preprocess text for better extraction
 */
function preprocessText(text, config) {
    if (!text) return '';

    let processed = text;

    // Remove binary artifacts and control characters
    processed = processed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');

    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ');

    if (config.preserveFormatting) {
        // Preserve line breaks and paragraph structure
        processed = processed.replace(/\n\s*\n/g, '\n\n');
    }

    return processed.trim();
}

/**
 * Extract text segments from PDF content
 */
function extractTextSegments(text, config) {
    const segments = [];

    // Regex for better text extraction
    const patterns = [
        // Standard text segments
        /([A-Za-z0-9][A-Za-z0-9\-\s,.!?;:'"()]{3,})/g,
        // Email addresses
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
        // URLs
        /(https?:\/\/[^\s]+)/g,
        // Numbers and dates
        /(\b\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b\d+\.\d+\b|\b\d{4,}\b)/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const segment = match[1].trim();
            if (segment.length >= config.minSegmentLength) {
                segments.push(segment);
            }
            if (segments.length >= config.maxSegments * 2) {
                break;
            }
        }
    }

    return segments;
}

/**
 * Filter segments to remove noise and short words
 */
function filterSegments(segments, config) {
    const filtered = [];
    const seen = new Set();

    for (const segment of segments) {
        // Skip duplicates
        const normalized = segment.toLowerCase();
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);

        // Skip very short segments
        if (segment.length < config.minSegmentLength) {
            continue;
        }

        // Skip segments that are just single letters or numbers
        if (config.excludeShortWords && /^[A-Za-z]{1,2}$/.test(segment)) {
            continue;
        }

        // Skip segments that are just whitespace or punctuation
        if (!/[A-Za-z0-9]/.test(segment)) {
            continue;
        }

        filtered.push(segment);

        if (filtered.length >= config.maxSegments) {
            break;
        }
    }

    return filtered;
}

/**
 * Generate preview text from segments
 */
function generatePreviewText(segments, config) {
    if (segments.length === 0) {
        return '';
    }

    // Join segments with appropriate spacing
    let preview = segments.join(' ');

    // Truncate if too long
    if (preview.length > config.maxPreviewLength) {
        preview = preview.substring(0, config.maxPreviewLength);
        // Try to end at a word boundary
        const lastSpace = preview.lastIndexOf(' ');
        if (lastSpace > config.maxPreviewLength * 0.8) {
            preview = preview.substring(0, lastSpace);
        }
        preview += '...';
    }

    return preview;
}

/**
 * Convert byte array to ASCII text
 */
function bytesToAscii(bytes) {
    if (!bytes || !bytes.length) {
        return '';
    }

    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];

        if (byte === 0x0A) {
            result += '\n';
        } else if (byte === 0x0D) {
            continue; // Skip carriage returns
        } else if (byte === 0x09) {
            result += '\t';
        } else if (byte >= 32 && byte <= 126) {
            // Printable ASCII characters
            result += String.fromCharCode(byte);
        } else if (byte >= 128 && byte <= 255) {
            // Extended ASCII - try to preserve
            result += String.fromCharCode(byte);
        }
        // Skip other control characters
    }

    return result;
}

/**
 * Decode Base64 string to byte array
 */
function decodeBase64ToBytes(base64) {
    const clean = String(base64).replace(/[^A-Za-z0-9+/=]/g, '');

    if (clean.length % 4 !== 0) {
        throw new Error('Invalid Base64 string length');
    }

    const bytes = [];

    for (let i = 0; i < clean.length; i += 4) {
        const enc1 = BASE64_ALPHABET.indexOf(clean[i]);
        const enc2 = BASE64_ALPHABET.indexOf(clean[i + 1]);
        const enc3 = BASE64_ALPHABET.indexOf(clean[i + 2]);
        const enc4 = BASE64_ALPHABET.indexOf(clean[i + 3]);

        if (enc1 < 0 || enc2 < 0) {
            throw new Error('Invalid Base64 character');
        }

        const chr1 = (enc1 << 2) | (enc2 >> 4);
        const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        const chr3 = ((enc3 & 3) << 6) | enc4;

        bytes.push(chr1 & 255);
        if (enc3 !== 64) {
            bytes.push(chr2 & 255);
        }
        if (enc4 !== 64) {
            bytes.push(chr3 & 255);
        }
    }

    return bytes;
}

execute;

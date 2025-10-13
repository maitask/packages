/**
 * @maitask/text-parser
 * High-performance text and markdown parser
 *
 * Supports:
 * - Plain text parsing with line/word/character analysis
 * - UTF-8 text from Base64 encoding
 * - Markdown files with metadata extraction
 * - Log files with structured output
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/**
 * Main execution function for text parsing
 * @param {Object} input - Input data with text or base64 content
 * @param {Object} options - Parsing options
 * @param {Object} context - Execution context
 * @returns {Object} Parsed text data with statistics
 */
function execute(input, options = {}, context = {}) {
    try {
        const text = ensureTextPayload(input);

        if (!text) {
            return createEmptyResponse(input);
        }

        const lines = text.split(/\r?\n/);
        const nonEmptyLines = lines.filter(line => line.trim().length > 0);
        const words = text.trim().split(/\s+/).filter(Boolean);

        // Detect file type based on extension or content
        const fileType = detectFileType(input, text);

        // Parse markdown if applicable
        const markdownData = fileType === 'markdown' ? parseMarkdown(text) : null;

        return {
            success: true,
            parser: 'text',
            fileType,
            text,
            lines,
            data: markdownData || {
                content: text,
                type: 'plaintext'
            },
            statistics: {
                totalLines: lines.length,
                nonEmptyLines: nonEmptyLines.length,
                wordCount: words.length,
                characterCount: text.length,
                byteSize: new TextEncoder().encode(text).length,
                avgWordsPerLine: nonEmptyLines.length > 0 ? Math.round(words.length / nonEmptyLines.length * 100) / 100 : 0,
                preview: nonEmptyLines.slice(0, 3).map(line => line.substring(0, 100))
            },
            metadata: {
                path: input?.path || null,
                size: input?.size || null,
                extension: input?.extension || detectExtension(input?.path),
                encoding: 'utf-8',
                mimeType: getMimeType(fileType),
                parsedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown parsing error',
                code: 'PARSE_ERROR',
                type: 'TextParsingError'
            },
            metadata: {
                parsedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

/**
 * Create empty response for no input
 */
function createEmptyResponse(input) {
    return {
        success: true,
        parser: 'text',
        fileType: 'empty',
        text: '',
        lines: [],
        data: { content: '', type: 'empty' },
        statistics: {
            totalLines: 0,
            nonEmptyLines: 0,
            wordCount: 0,
            characterCount: 0,
            byteSize: 0,
            avgWordsPerLine: 0,
            preview: []
        },
        metadata: {
            path: input?.path || null,
            encoding: 'utf-8',
            mimeType: 'text/plain',
            parsedAt: new Date().toISOString(),
            version: '1.0.0'
        }
    };
}

/**
 * Detect file type based on extension and content
 */
function detectFileType(input, text) {
    const ext = (input?.extension || detectExtension(input?.path) || '').toLowerCase();

    if (ext === 'md' || ext === 'markdown') {
        return 'markdown';
    }
    if (ext === 'log') {
        return 'log';
    }
    if (ext === 'txt' || ext === 'text') {
        return 'plaintext';
    }

    // Content-based detection
    if (text.includes('# ') || text.includes('## ') || text.includes('```')) {
        return 'markdown';
    }

    return 'plaintext';
}

/**
 * Get MIME type for file type
 */
function getMimeType(fileType) {
    switch (fileType) {
        case 'markdown': return 'text/markdown';
        case 'log': return 'text/x-log';
        default: return 'text/plain';
    }
}

/**
 * Extract extension from file path
 */
function detectExtension(path) {
    if (!path || typeof path !== 'string') return null;
    const match = path.match(/\.([^.]+)$/);
    return match ? match[1] : null;
}

/**
 * Parse markdown content and extract structure
 */
function parseMarkdown(text) {
    const lines = text.split(/\r?\n/);
    const structure = {
        content: text,
        type: 'markdown',
        headings: [],
        codeBlocks: [],
        links: [],
        images: []
    };

    let inCodeBlock = false;
    let codeBlockStart = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code blocks
        if (line.startsWith('```')) {
            if (inCodeBlock) {
                structure.codeBlocks.push({
                    language: lines[codeBlockStart].substring(3).trim(),
                    startLine: codeBlockStart + 1,
                    endLine: i + 1,
                    content: lines.slice(codeBlockStart + 1, i).join('\n')
                });
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
                codeBlockStart = i;
            }
            continue;
        }

        if (inCodeBlock) continue;

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            structure.headings.push({
                level: headingMatch[1].length,
                text: headingMatch[2].trim(),
                line: i + 1
            });
        }

        // Links
        const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
        for (const match of linkMatches) {
            structure.links.push({
                text: match[1],
                url: match[2],
                line: i + 1
            });
        }

        // Images
        const imageMatches = line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g);
        for (const match of imageMatches) {
            structure.images.push({
                alt: match[1],
                url: match[2],
                line: i + 1
            });
        }
    }

    return structure;
}

/**
 * Extract text content from input payload
 */
function ensureTextPayload(input) {
    if (!input) {
        return '';
    }

    // Direct text property
    if (typeof input.text === 'string') {
        return input.text;
    }

    // Base64 encoded content
    if (typeof input.base64 === 'string' && input.base64.length > 0) {
        return decodeBase64ToUtf8(input.base64);
    }

    // Handle string input directly
    if (typeof input === 'string') {
        return input;
    }

    return '';
}

/**
 * Decode Base64 to UTF-8 text
 */
function decodeBase64ToUtf8(base64) {
    try {
        const bytes = decodeBase64ToBytes(base64);
        return bytesToUtf8(bytes);
    } catch (error) {
        throw new Error(`Base64 decoding failed: ${error.message}`);
    }
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

/**
 * Convert byte array to UTF-8 string
 */
function bytesToUtf8(bytes) {
    let result = '';
    let i = 0;

    while (i < bytes.length) {
        const byte1 = bytes[i++];

        if (byte1 < 0x80) {
            // Single-byte character (ASCII)
            result += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0 && i < bytes.length) {
            // Two-byte character
            const byte2 = bytes[i++];
            result += String.fromCharCode(((byte1 & 0x1F) << 6) | (byte2 & 0x3F));
        } else if (byte1 >= 0xE0 && byte1 < 0xF0 && i + 1 < bytes.length) {
            // Three-byte character
            const byte2 = bytes[i++];
            const byte3 = bytes[i++];
            result += String.fromCharCode(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F));
        } else if (byte1 >= 0xF0 && i + 2 < bytes.length) {
            // Four-byte character (surrogate pair)
            const byte2 = bytes[i++];
            const byte3 = bytes[i++];
            const byte4 = bytes[i++];
            const codePoint = ((byte1 & 0x07) << 18) |
                ((byte2 & 0x3F) << 12) |
                ((byte3 & 0x3F) << 6) |
                (byte4 & 0x3F);

            if (codePoint > 0x10000) {
                const offset = codePoint - 0x10000;
                result += String.fromCharCode((offset >> 10) + 0xD800, (offset & 0x3FF) + 0xDC00);
            } else {
                result += String.fromCharCode(codePoint);
            }
        } else {
            // Invalid UTF-8 sequence, skip
            continue;
        }
    }

    return result;
}

execute;

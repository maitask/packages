/**
 * @maitask/pdf-parser
 * Extract Info metadata and uncompressed text operators from PDF bytes.
 *
 * Encrypted files fail closed. FlateDecode and other filtered streams are
 * counted and skipped; this extractor does not inflate compressed content.
 */

const PACKAGE_NAME = '@maitask/pdf-parser';
const PACKAGE_VERSION = '0.1.0';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const INFO_KEYS = ['Title', 'Author', 'Subject', 'Creator', 'Producer', 'CreationDate', 'ModDate'];

function execute(input, options = {}, context = {}) {
  try {
    const config = {
      maxTextLength: clampPositiveInt(options.maxTextLength, 200000, 1, 2_000_000)
    };
    const bytes = extractBytes(input);
    if (!bytes.length) {
      throw Object.assign(new Error('PDF content is required'), { code: 'PDF_INPUT_REQUIRED' });
    }

    const headerOffset = findPdfHeader(bytes);
    if (headerOffset < 0) {
      throw Object.assign(new Error('Input is not a PDF document'), { code: 'PDF_INVALID_HEADER' });
    }

    const source = bytesToLatin1(bytes.slice(headerOffset));
    if (isEncrypted(source)) {
      throw Object.assign(new Error('Encrypted PDFs are not supported'), { code: 'PDF_ENCRYPTED' });
    }

    const streams = inspectStreams(source);
    const text = truncateText(extractUncompressedText(source), config.maxTextLength);
    const info = extractInfoDictionary(source);

    return {
      success: true,
      data: {
        text,
        pages: countPages(source),
        uncompressedStreams: streams.uncompressed,
        compressedStreamsSkipped: streams.compressed,
        metadata: info
      },
      metadata: {
        package: PACKAGE_NAME,
        extractor: 'uncompressed-pdf',
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error.message || 'PDF parsing failed',
        code: error.code || 'PDF_PARSE_ERROR',
        type: error.name || 'PdfParseError'
      },
      metadata: {
        package: PACKAGE_NAME,
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  }
}

function extractBytes(input) {
  if (!input) return [];
  if (typeof input === 'string') {
    return looksLikeBase64(input) ? decodeBase64ToBytes(input) : stringToBytes(input);
  }
  if (Array.isArray(input)) {
    return input.map(value => Number(value) & 0xff);
  }
  if (input instanceof Uint8Array) {
    return Array.from(input);
  }
  if (typeof input.base64 === 'string' && input.base64.length > 0) {
    return decodeBase64ToBytes(input.base64);
  }
  if (typeof input.text === 'string') {
    return stringToBytes(input.text);
  }
  if (Array.isArray(input.bytes)) {
    return input.bytes.map(value => Number(value) & 0xff);
  }
  return [];
}

function looksLikeBase64(value) {
  const clean = value.replace(/\s+/g, '');
  return clean.length >= 8 && clean.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

function findPdfHeader(bytes) {
  const limit = Math.min(bytes.length - 4, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) {
      return index;
    }
  }
  return -1;
}

function isEncrypted(source) {
  return /\/Encrypt\b/.test(source.replace(/stream[\s\S]*?endstream/g, 'stream endstream'));
}

function countPages(source) {
  const matches = source.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

function inspectStreams(source) {
  let uncompressed = 0;
  let compressed = 0;
  const pattern = /<<([\s\S]*?)>>\s*stream/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (/\/Filter\b/.test(match[1])) {
      compressed += 1;
    } else {
      uncompressed += 1;
    }
  }
  return { uncompressed, compressed };
}

function extractUncompressedText(source) {
  const texts = [];
  const pattern = /<<([\s\S]*?)>>\s*stream\r?\n?([\s\S]*?)endstream/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (/\/Filter\b/.test(match[1])) continue;
    const extracted = extractTextOperators(match[2]);
    if (extracted) texts.push(extracted);
  }
  if (texts.length === 0) {
    const fallback = extractTextOperators(source);
    if (fallback) texts.push(fallback);
  }
  return texts.join('\n').trim();
}

function extractTextOperators(content) {
  const blocks = [];
  const btPattern = /\bBT\b([\s\S]*?)\bET\b/g;
  let block;
  while ((block = btPattern.exec(content))) {
    const parts = [];
    const body = block[1];
    const tjPattern = /(\((?:\\.|[^\\)])*\)|<[^>]*>)\s*Tj/g;
    let tj;
    while ((tj = tjPattern.exec(body))) {
      parts.push(decodePdfString(tj[1]));
    }
    const tjArrayPattern = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArray;
    while ((tjArray = tjArrayPattern.exec(body))) {
      const itemPattern = /(\((?:\\.|[^\\)])*\)|<[^>]*>)/g;
      let item;
      while ((item = itemPattern.exec(tjArray[1]))) {
        parts.push(decodePdfString(item[1]));
      }
    }
    const joined = parts.join('').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    if (joined.trim()) blocks.push(joined);
  }
  return blocks.join('\n');
}

function extractInfoDictionary(source) {
  const info = {};
  const infoRef = source.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);
  let haystack = source;
  if (infoRef) {
    const objectPattern = new RegExp(
      `${infoRef[1]}\\s+${infoRef[2]}\\s+obj\\s*(<<[\\s\\S]*?>>)`,
      'm'
    );
    const objectMatch = source.match(objectPattern);
    if (objectMatch) haystack = objectMatch[1];
  }
  for (const key of INFO_KEYS) {
    const match = haystack.match(new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[^>]*>)`));
    if (!match) continue;
    const value = decodePdfString(match[1]).trim();
    if (!value) continue;
    if (key === 'CreationDate' || key === 'ModDate') {
      info[key === 'CreationDate' ? 'creationDate' : 'modificationDate'] = parsePdfDate(value);
    } else {
      info[key.charAt(0).toLowerCase() + key.slice(1)] = value;
    }
  }
  return info;
}

function decodePdfString(token) {
  if (!token) return '';
  if (token.startsWith('<') && token.endsWith('>')) {
    const hex = token.slice(1, -1).replace(/\s+/g, '');
    const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
    const bytes = [];
    for (let index = 0; index < padded.length; index += 2) {
      bytes.push(parseInt(padded.slice(index, index + 2), 16));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let text = '';
      for (let index = 2; index + 1 < bytes.length; index += 2) {
        text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
      }
      return text;
    }
    return bytesToLatin1(bytes);
  }
  if (!(token.startsWith('(') && token.endsWith(')'))) return token;
  const inner = token.slice(1, -1);
  let output = '';
  for (let index = 0; index < inner.length; index += 1) {
    const current = inner[index];
    if (current !== '\\') {
      output += current;
      continue;
    }
    const next = inner[index + 1];
    if (next === 'n') {
      output += '\n';
      index += 1;
    } else if (next === 'r') {
      output += '\r';
      index += 1;
    } else if (next === 't') {
      output += '\t';
      index += 1;
    } else if (next === 'b') {
      output += '\b';
      index += 1;
    } else if (next === 'f') {
      output += '\f';
      index += 1;
    } else if (next === '\\' || next === '(' || next === ')') {
      output += next;
      index += 1;
    } else if (next >= '0' && next <= '7') {
      let octal = next;
      let consumed = 1;
      while (consumed < 3 && index + 1 + consumed < inner.length) {
        const digit = inner[index + 1 + consumed];
        if (digit < '0' || digit > '7') break;
        octal += digit;
        consumed += 1;
      }
      output += String.fromCharCode(parseInt(octal, 8));
      index += consumed;
    } else if (next === '\n' || next === '\r') {
      index += next === '\r' && inner[index + 2] === '\n' ? 2 : 1;
    } else if (next != null) {
      output += next;
      index += 1;
    }
  }
  if (output.charCodeAt(0) === 0xfe && output.charCodeAt(1) === 0xff) {
    let text = '';
    for (let index = 2; index + 1 < output.length; index += 2) {
      text += String.fromCharCode((output.charCodeAt(index) << 8) | output.charCodeAt(index + 1));
    }
    return text;
  }
  return output;
}

function parsePdfDate(value) {
  const clean = String(value).replace(/^D:/, '');
  const match = clean.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return value;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00'] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function clampPositiveInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function stringToBytes(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    bytes.push(value.charCodeAt(index) & 0xff);
  }
  return bytes;
}

function bytesToLatin1(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index] & 0xff);
  }
  return result;
}

function decodeBase64ToBytes(base64) {
  const clean = String(base64).replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean || clean.length % 4 !== 0) {
    throw Object.assign(new Error('Invalid Base64 PDF payload'), { code: 'PDF_INVALID_BASE64' });
  }
  const bytes = [];
  for (let index = 0; index < clean.length; index += 4) {
    const enc1 = BASE64_ALPHABET.indexOf(clean[index]);
    const enc2 = BASE64_ALPHABET.indexOf(clean[index + 1]);
    const enc3 = BASE64_ALPHABET.indexOf(clean[index + 2]);
    const enc4 = BASE64_ALPHABET.indexOf(clean[index + 3]);
    if (enc1 < 0 || enc2 < 0) {
      throw Object.assign(new Error('Invalid Base64 PDF payload'), { code: 'PDF_INVALID_BASE64' });
    }
    bytes.push(((enc1 << 2) | (enc2 >> 4)) & 255);
    if (enc3 !== 64) bytes.push(((enc2 & 15) << 4) | (enc3 >> 2));
    if (enc4 !== 64) bytes.push(((enc3 & 3) << 6) | enc4);
  }
  return bytes;
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;

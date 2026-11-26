/**
 * @maitask/pdf-parser
 * Extract Info metadata, uncompressed text streams, and FlateDecode compressed text streams from PDF bytes.
 *
 * Encrypted files fail closed. FlateDecode streams are decompressed in pure JavaScript;
 * unsupported non-Flate compressed filters remain skipped and counted cleanly.
 */

const PACKAGE_NAME = '@maitask/pdf-parser';
const PACKAGE_VERSION = '0.1.1';
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
    const extracted = extractStreamTexts(source, config.maxTextLength);
    const text = truncateText(extracted.text, config.maxTextLength);
    const info = extractInfoDictionary(source);

    return {
      success: true,
      data: {
        text,
        pages: countPages(source),
        uncompressedStreams: streams.uncompressed,
        decompressedStreams: extracted.decompressedStreams,
        compressedStreamsSkipped: extracted.unsupportedStreams,
        metadata: info
      },
      metadata: {
        package: PACKAGE_NAME,
        extractor: extracted.decompressedStreams > 0 ? 'flate-and-uncompressed-pdf' : 'uncompressed-pdf',
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

function extractStreamTexts(source, maxBytes = 2_000_000) {
  const texts = [];
  let decompressedStreams = 0;
  let unsupportedStreams = 0;
  const pattern = /<<([\s\S]*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;
  while ((match = pattern.exec(source))) {
    const dict = match[1];
    const body = match[2];
    const hasFilter = /\/Filter\b/.test(dict);
    if (!hasFilter) {
      const extracted = extractTextOperators(body);
      if (extracted) texts.push(extracted);
      continue;
    }
    const isFlateOnly =
      /\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dict) &&
      !/\/(ASCIIHexDecode|ASCII85Decode|LZWDecode|RunLengthDecode|CCITTFaxDecode|JBIG2Decode|DCTDecode|JPXDecode)\b/.test(dict);
    if (!isFlateOnly) {
      unsupportedStreams += 1;
      continue;
    }
    try {
      const inflatedBytes = inflateZlib(stringToBytes(body), Math.min(Math.max(maxBytes * 4, 2_000_000), 8_000_000));
      decompressedStreams += 1;
      const inflatedText = bytesToLatin1(inflatedBytes);
      const extracted = extractTextOperators(inflatedText);
      if (extracted) texts.push(extracted);
    } catch {
      unsupportedStreams += 1;
    }
  }
  if (texts.length === 0) {
    const fallback = extractTextOperators(source);
    if (fallback) texts.push(fallback);
  }
  return {
    text: texts.join('\n').trim(),
    decompressedStreams,
    unsupportedStreams
  };
}

function inflateZlib(bytes, maxOutBytes) {
  if (!bytes || bytes.length < 6) {
    throw new Error('Truncated zlib stream');
  }
  const cmf = bytes[0];
  const flg = bytes[1];
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0) {
    throw new Error('Invalid zlib header');
  }
  let pos = 2;
  if (flg & 0x20) pos += 4;
  return inflateRaw(bytes, pos, maxOutBytes);
}

function inflateRaw(bytes, startPos, maxOutBytes) {
  let bytePos = startPos;
  let bitBuf = 0;
  let bitCount = 0;
  const out = [];

  const readBits = n => {
    while (bitCount < n) {
      if (bytePos >= bytes.length) throw new Error('Unexpected end of deflate stream');
      bitBuf |= (bytes[bytePos++] & 0xff) << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const buildTree = lengths => {
    const maxLen = Math.max(...lengths, 0);
    const blCount = new Array(maxLen + 1).fill(0);
    for (const len of lengths) if (len > 0) blCount[len]++;
    const nextCode = new Array(maxLen + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= maxLen; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const table = new Map();
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) {
        const c = nextCode[len]++;
        table.set(`${len}:${c}`, sym);
      }
    }
    return { table, maxLen };
  };

  const decodeSym = tree => {
    let code = 0;
    for (let len = 1; len <= tree.maxLen; len++) {
      code = (code << 1) | readBits(1);
      const sym = tree.table.get(`${len}:${code}`);
      if (sym !== undefined) return sym;
    }
    throw new Error('Invalid Huffman symbol in deflate stream');
  };

  const FIXED_LIT = (() => {
    const lens = new Array(288);
    for (let i = 0; i <= 143; i++) lens[i] = 8;
    for (let i = 144; i <= 255; i++) lens[i] = 9;
    for (let i = 256; i <= 279; i++) lens[i] = 7;
    for (let i = 280; i <= 287; i++) lens[i] = 8;
    return buildTree(lens);
  })();
  const FIXED_DIST = buildTree(new Array(32).fill(5));
  const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  let bfinal = 0;
  do {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (bytePos + 4 > bytes.length) throw new Error('Truncated stored block');
      const len = bytes[bytePos] | (bytes[bytePos + 1] << 8);
      const nlen = bytes[bytePos + 2] | (bytes[bytePos + 3] << 8);
      bytePos += 4;
      if ((len ^ 0xffff) !== nlen || bytePos + len > bytes.length) {
        throw new Error('Corrupt stored deflate block');
      }
      if (out.length + len > maxOutBytes) throw new Error('Decompressed PDF stream exceeds limit');
      for (let i = 0; i < len; i++) out.push(bytes[bytePos++]);
      continue;
    }

    let litTree = FIXED_LIT;
    let distTree = FIXED_DIST;
    if (btype === 2) {
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;
      const clLens = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
      const clTree = buildTree(clLens);
      const lengths = [];
      while (lengths.length < hlit + hdist) {
        const sym = decodeSym(clTree);
        if (sym < 16) {
          lengths.push(sym);
        } else {
          const repeat = sym === 16 ? 3 + readBits(2) : sym === 17 ? 3 + readBits(3) : 11 + readBits(7);
          if (sym === 16 && lengths.length === 0) {
            throw new Error('Corrupt deflate stream: repeat previous length on empty table');
          }
          if (lengths.length + repeat > hlit + hdist) {
            throw new Error('Corrupt deflate stream: code length repeat exceeds symbol table');
          }
          const val = sym === 16 ? lengths[lengths.length - 1] : 0;
          for (let r = 0; r < repeat; r++) lengths.push(val);
        }
      }
      litTree = buildTree(lengths.slice(0, hlit));
      distTree = buildTree(lengths.slice(hlit));
    } else if (btype !== 1) {
      throw new Error('Unsupported deflate block type');
    }

    while (true) {
      const sym = decodeSym(litTree);
      if (sym < 256) {
        if (out.length >= maxOutBytes) throw new Error('Decompressed PDF stream exceeds limit');
        out.push(sym);
      } else if (sym === 256) {
        break;
      } else {
        const lenIdx = sym - 257;
        if (lenIdx < 0 || lenIdx >= LEN_BASE.length) {
          throw new Error('Corrupt deflate stream: invalid length symbol');
        }
        const length = LEN_BASE[lenIdx] + readBits(LEN_EXTRA[lenIdx]);
        const distIdx = decodeSym(distTree);
        if (distIdx < 0 || distIdx >= DIST_BASE.length) {
          throw new Error('Corrupt deflate stream: invalid distance symbol');
        }
        const distance = DIST_BASE[distIdx] + readBits(DIST_EXTRA[distIdx]);
        if (distance <= 0 || distance > out.length) {
          throw new Error('Corrupt deflate stream: invalid back-reference distance');
        }
        if (out.length + length > maxOutBytes) throw new Error('Decompressed PDF stream exceeds limit');
        for (let i = 0; i < length; i++) {
          out.push(out[out.length - distance]);
        }
      }
    }
  } while (!bfinal);

  return out;
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

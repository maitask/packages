/**
 * @maitask/audio-processor
 * Speech-to-text, translation, audio analysis, and speech synthesis.
 *
 * @version 0.1.2
 * @license MIT
 */

const PACKAGE_VERSION = '0.1.2';

/**
 * @param {Object} input
 * @param {string} [input.audioUrl]
 * @param {string} [input.audioData]
 * @param {string} [input.task] transcribe | translate | analyze | summarize | generate
 * @param {string} [input.prompt]
 * @param {string} [input.text]
 * @param {string} [input.language]
 * @param {string} [input.provider] whisper | gemini | openai
 * @param {string} [input.model]
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {Object} context
 * @returns {Object}
 */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_RESPONSE_BYTES = 5 * 1024 * 1024;

async function execute(input = {}, options = {}, context = {}) {
  let activeApiKey = '';
  try {
    const safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const safeContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const task = safeInput.task || safeOptions.task || 'transcribe';
    const provider =
      safeInput.provider || safeOptions.provider || (task === 'generate' ? 'openai' : 'whisper');
    const apiKey = resolveProviderApiKey(provider, safeOptions, safeContext);
    activeApiKey = apiKey;

    let result;
    if (task === 'generate') {
      if (provider !== 'openai') {
        throw new Error(`Unsupported provider: ${provider} with task: ${task}`);
      }
      result = await generateAudioWithOpenAI(safeInput, safeOptions, apiKey);
    } else if (!safeInput.audioUrl && !safeInput.audioData) {
      throw new Error('Either audioUrl or audioData is required');
    } else if (
      provider === 'whisper' ||
      (provider === 'openai' && (task === 'transcribe' || task === 'translate'))
    ) {
      result = await processWithWhisper(safeInput, safeOptions, apiKey);
    } else if (provider === 'gemini') {
      result = await processWithGemini(safeInput, safeOptions, apiKey);
    } else {
      throw new Error(`Unsupported provider: ${provider} with task: ${task}`);
    }

    return {
      success: true,
      data: result,
      metadata: {
        package: '@maitask/audio-processor',
        provider,
        task,
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  } catch (error) {
    const rawMsg = error?.message || 'Audio processing failed';
    let safeMsg = activeApiKey ? rawMsg.split(activeApiKey).join('[redacted]') : rawMsg;
    safeMsg = safeMsg.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
    return {
      success: false,
      error: {
        message: safeMsg,
        code: 'AUDIO_PROCESSOR_ERROR',
        type: error?.constructor?.name || 'Error'
      },
      metadata: {
        package: '@maitask/audio-processor',
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  }
}

function resolveProviderApiKey(provider, options = {}, context = {}) {
  const secrets = (context && typeof context === 'object' && context.secrets) || {};
  const fromSecrets = provider === 'gemini'
    ? secrets.GEMINI_API_KEY || secrets.GOOGLE_API_KEY
    : secrets.OPENAI_API_KEY;
  const apiKey = options.apiKey || options.api_key || fromSecrets;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('API key is required via options.apiKey or context.secrets');
  }
  return apiKey;
}

async function processWithWhisper(input, options, apiKey) {
  const model = input.model || options.model || 'whisper-1';
  const task = input.task || options.task || 'transcribe';
  const audioBytes = await readAudioBytes(input, options);
  const fields = [['model', model]];

  const responseFormat = String(input.response_format || options.response_format || '').trim().toLowerCase();
  if (input.language) fields.push(['language', input.language]);
  if (input.prompt) fields.push(['prompt', input.prompt]);
  if (input.temperature !== undefined) fields.push(['temperature', String(input.temperature)]);
  if (responseFormat) fields.push(['response_format', responseFormat]);
  if (input.timestamp_granularities) {
    fields.push(['timestamp_granularities', JSON.stringify(input.timestamp_granularities)]);
  }

  const encoded = encodeMultipart(fields, {
    name: 'file',
    filename: 'audio.mp3',
    contentType: input.mimeType || options.mimeType || 'audio/mpeg',
    bytes: audioBytes
  });

  const endpoint =
    task === 'translate'
      ? 'https://api.openai.com/v1/audio/translations'
      : 'https://api.openai.com/v1/audio/transcriptions';

  const useRuntimeBase64 = typeof globalThis.Deno?.core?.ops?.op_http_request === 'function';
  const response = await performFetch(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${encoded.boundary}`
      },
      ...(useRuntimeBase64 ? { bodyBase64: encoded.bodyBase64 } : { body: encoded.bytes })
    },
    options
  );

  if (!response.ok) {
    const errorText = await readBoundedErrorText(response);
    throw new Error(`Whisper API Error (${response.status}): ${errorText}`);
  }

  if (responseFormat === 'text' || responseFormat === 'srt' || responseFormat === 'vtt') {
    const rawText = await readBoundedText(response, MAX_TEXT_RESPONSE_BYTES, 'Whisper response exceeds byte limit');
    return {
      text: rawText,
      format: responseFormat,
      raw: rawText
    };
  }

  let whisperResult;
  if (!response?.body?.getReader && typeof response?.text !== 'function' && typeof response?.json === 'function') {
    whisperResult = await response.json();
  } else {
    const rawJson = await readBoundedText(response, MAX_TEXT_RESPONSE_BYTES, 'Whisper response exceeds byte limit');
    whisperResult = rawJson ? JSON.parse(rawJson) : {};
  }
  return {
    text: whisperResult.text,
    language: whisperResult.language,
    duration: whisperResult.duration,
    segments: whisperResult.segments,
    words: whisperResult.words,
    raw: whisperResult
  };
}

async function processWithGemini(input, options, apiKey) {
  const model = String(input.model || options.model || 'gemini-2.5-pro').trim();
  const task = input.task || options.task || 'analyze';

  let prompt;
  if (input.prompt) {
    prompt = input.prompt;
  } else {
    switch (task) {
      case 'transcribe':
        prompt = 'Transcribe this audio exactly as spoken, including all words and punctuation.';
        break;
      case 'analyze':
        prompt =
          'Analyze this audio. Describe what you hear, including speech content, tone, emotions, background sounds, and any other notable audio characteristics.';
        break;
      case 'summarize':
        prompt = 'Summarize the main points and key information from this audio.';
        break;
      default:
        prompt = 'Describe what you hear in this audio.';
    }
  }

  let audioData = input.audioData;
  if (input.audioUrl && !audioData) {
    const audioBytes = await readAudioBytes(input, options);
    audioData = bytesToBase64(audioBytes);
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.mimeType || options.mimeType || 'audio/mpeg',
              data: audioData
            }
          }
        ]
      }
    ]
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await performFetch(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(requestBody)
    },
    options
  );

  if (!response.ok) {
    const errorText = await readBoundedErrorText(response);
    throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
  }

  const geminiResult = await response.json();
  const analysisText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    analysis: analysisText,
    raw: geminiResult
  };
}

async function generateAudioWithOpenAI(input, options, apiKey) {
  const model = input.model || options.model || 'tts-1-hd';
  const voice = input.voice || options.voice || 'alloy';
  const text = input.text || input.prompt;

  if (!text) {
    throw new Error('Text is required for audio generation');
  }

  const requestBody = {
    model,
    input: text,
    voice,
    response_format: input.response_format || options.response_format || 'mp3',
    speed: input.speed || options.speed || 1.0
  };

  if (model === 'gpt-4o-mini-tts' && (input.instruction || options.instruction)) {
    requestBody.instruction = input.instruction || options.instruction;
  }

  const response = await performFetch(
    'https://api.openai.com/v1/audio/speech',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    },
    options
  );

  if (!response.ok) {
    const errorText = await readBoundedErrorText(response);
    throw new Error(`OpenAI TTS API Error (${response.status}): ${errorText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  return {
    audioData: bytesToBase64(new Uint8Array(audioBuffer)),
    format: requestBody.response_format,
    model,
    voice
  };
}

async function readAudioBytes(input, options = {}) {
  if (input.audioUrl) {
    const parsed = new URL(String(input.audioUrl).trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('audioUrl must use http or https');
    }
    if (parsed.username || parsed.password) {
      throw new Error('audioUrl must not embed credentials');
    }
    if (options.allowPrivateHosts !== true && isBlockedAudioHost(parsed.hostname)) {
      throw new Error('audioUrl host is not permitted');
    }
    const audioResponse = await performFetch(
      parsed.toString(),
      {},
      { ...(options || {}), maxResponseBytes: MAX_AUDIO_BYTES },
      'audioUrl redirects are not allowed'
    );
    if (!audioResponse.ok) {
      if (audioResponse?.body && typeof audioResponse.body.cancel === 'function') {
        try { await audioResponse.body.cancel(); } catch {}
      }
      throw new Error(`Failed to fetch audio (${audioResponse.status})`);
    }
    return await readBoundedAudioBytes(audioResponse, MAX_AUDIO_BYTES);
  }

  if (input.audioData) {
    return base64ToBytes(input.audioData);
  }

  throw new Error('Either audioUrl or audioData is required');
}

async function readBoundedAudioBytes(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    if (response?.body && typeof response.body.cancel === 'function') {
      try { await response.body.cancel(); } catch {}
    }
    throw new Error('Audio payload exceeds 25MB limit');
  }
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const part = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (total + part.byteLength > maxBytes) {
          throw new Error('Audio payload exceeds 25MB limit');
        }
        chunks.push(part);
        total += part.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    return merged;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error('Audio payload exceeds 25MB limit');
  }
  return bytes;
}

async function readBoundedText(response, maxBytes, limitMessage) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    let out = '';
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (total + value.byteLength > maxBytes) {
          throw new Error(limitMessage);
        }
        out += decoder ? decoder.decode(value, { stream: true }) : String.fromCharCode(...value);
        total += value.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    if (decoder) out += decoder.decode();
    return out;
  }
  const text = await response.text();
  if (typeof text === 'string' && text.length > maxBytes) {
    throw new Error(limitMessage);
  }
  return text || '';
}

function usesMaitaskRuntimeFetch() {
  return Boolean(
    typeof Deno !== 'undefined' &&
      Deno &&
      Deno.core &&
      Deno.core.ops &&
      typeof Deno.core.ops.op_http_request === 'function'
  );
}

function resolveTimeoutMs(options = {}) {
  const n = Number(options?.timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 30000;
  return Math.min(Math.max(Math.trunc(n), 1000), 120000);
}

async function performFetch(url, init = {}, options = {}, redirectErrorMessage = 'HTTP redirects are not allowed') {
  const timeoutMs = resolveTimeoutMs(options);
  const runtimeFetch = usesMaitaskRuntimeFetch();
  const controller = runtimeFetch ? null : new AbortController();
  const timer = runtimeFetch ? null : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchInit = {
      ...init,
      redirect: 'manual',
      timeoutMs
    };
    if (runtimeFetch) {
      fetchInit.maxResponseBytes = options?.maxResponseBytes || MAX_TEXT_RESPONSE_BYTES;
    } else {
      fetchInit.signal = controller.signal;
    }
    const response = await fetch(url, fetchInit);
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      if (response?.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch {}
      }
      throw new Error(redirectErrorMessage);
    }
    return response;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

async function readBoundedErrorText(response, maxBytes = 16384) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    let out = '';
    let total = 0;
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const remaining = maxBytes - total;
          const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
          out += decoder ? decoder.decode(slice, { stream: true }) : String.fromCharCode(...slice);
          total += value.byteLength;
          if (total >= maxBytes) break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
    if (decoder) out += decoder.decode();
    return out;
  }
  if (typeof response?.text === 'function') {
    const text = await response.text();
    return typeof text === 'string' ? text.slice(0, maxBytes) : '';
  }
  return '';
}

function isBlockedAudioHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (
    !host ||
    host === 'localhost' ||
    host === 'local' ||
    host === 'internal' ||
    host === 'localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain')
  ) {
    return true;
  }
  if (host.includes(':')) {
    const clean = host.split('%')[0];
    const hextets = parseIpv6Hextets(clean);
    if (!hextets) return true;
    const allZero = hextets.every(part => part === 0);
    const isLoopback = hextets.slice(0, 7).every(part => part === 0) && hextets[7] === 1;
    if (allZero || isLoopback) return true;
    if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
    if (hextets.slice(0, 5).every(part => part === 0) && hextets[5] === 0xffff) return true; // ::ffff:0:0/96
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [, a, b, c, d] = ipv4.map(Number);
  if ([a, b, c, d].some(octet => octet < 0 || octet > 255)) return true;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function parseIpv6Hextets(address) {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parsePart = part => {
    if (!part) return [];
    const tokens = part.split(':');
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token) return null;
      if (token.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const v4 = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (!v4) return null;
        const octets = v4.slice(1).map(Number);
        if (octets.some(o => o < 0 || o > 255)) return null;
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        out.push(parseInt(token, 16));
      }
    }
    return out;
  };
  const left = parsePart(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parsePart(halves[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

function sanitizeHeaderParam(value) {
  return String(value || '').replace(/[\r\n"\\]/g, '_');
}

function encodeMultipart(fields, file) {
  const boundary = `maitask-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const pushText = value => chunks.push(utf8Encode(value));

  for (const [name, value] of fields) {
    const safeName = sanitizeHeaderParam(name);
    pushText(
      `--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"\r\n\r\n${value}\r\n`
    );
  }

  const safeField = sanitizeHeaderParam(file.name);
  const safeFilename = sanitizeHeaderParam(file.filename);
  const safeContentType = String(file.contentType || 'application/octet-stream').replace(/[\r\n]/g, '');
  pushText(
    `--${boundary}\r\nContent-Disposition: form-data; name="${safeField}"; filename="${safeFilename}"\r\nContent-Type: ${safeContentType}\r\n\r\n`
  );
  chunks.push(file.bytes);
  pushText(`\r\n--${boundary}--\r\n`);

  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { boundary, bytes, bodyBase64: bytesToBase64(bytes) };
}

function utf8Encode(value) {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(value);
  }
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
    else bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
  }
  return Uint8Array.from(bytes);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;

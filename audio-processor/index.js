/**
 * @maitask/audio-processor
 * Speech-to-text, translation, audio analysis, and speech synthesis.
 *
 * @version 0.1.1
 * @license MIT
 */

const PACKAGE_VERSION = '0.1.1';

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
async function execute(input = {}, options = {}, context = {}) {
  try {
    const apiKey = options.apiKey || options.api_key;
    if (!apiKey) {
      throw new Error('API key is required. Provide via options.apiKey');
    }

    const task = input.task || options.task || 'transcribe';
    const provider =
      input.provider || options.provider || (task === 'generate' ? 'openai' : 'whisper');

    let result;
    if (task === 'generate') {
      if (provider !== 'openai') {
        throw new Error(`Unsupported provider: ${provider} with task: ${task}`);
      }
      result = await generateAudioWithOpenAI(input, options, apiKey);
    } else if (!input.audioUrl && !input.audioData) {
      throw new Error('Either audioUrl or audioData is required');
    } else if (
      provider === 'whisper' ||
      (provider === 'openai' && (task === 'transcribe' || task === 'translate'))
    ) {
      result = await processWithWhisper(input, options, apiKey);
    } else if (provider === 'gemini') {
      result = await processWithGemini(input, options, apiKey);
    } else {
      throw new Error(`Unsupported provider: ${provider} with task: ${task}`);
    }

    return {
      success: true,
      data: result,
      metadata: {
        provider,
        task,
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error.message,
        code: 'AUDIO_PROCESSOR_ERROR',
        type: error.constructor.name
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  }
}

async function processWithWhisper(input, options, apiKey) {
  const model = input.model || options.model || 'whisper-1';
  const task = input.task || options.task || 'transcribe';
  const audioBytes = await readAudioBytes(input);
  const fields = [['model', model]];

  if (input.language) fields.push(['language', input.language]);
  if (input.prompt) fields.push(['prompt', input.prompt]);
  if (input.temperature !== undefined) fields.push(['temperature', String(input.temperature)]);
  if (input.response_format) fields.push(['response_format', input.response_format]);
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${encoded.boundary}`
    },
    bodyBase64: encoded.bodyBase64
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API Error (${response.status}): ${errorText}`);
  }

  const whisperResult = await response.json();
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
  const model = input.model || options.model || 'gemini-2.5-pro';
  const task = input.task || 'analyze';

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
    const audioBytes = await readAudioBytes(input);
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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
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

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
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

async function readAudioBytes(input) {
  if (input.audioUrl) {
    const audioResponse = await fetch(input.audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio (${audioResponse.status})`);
    }
    return new Uint8Array(await audioResponse.arrayBuffer());
  }

  if (input.audioData) {
    return base64ToBytes(input.audioData);
  }

  throw new Error('Either audioUrl or audioData is required');
}

function encodeMultipart(fields, file) {
  const boundary = `maitask-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const pushText = value => chunks.push(utf8Encode(value));

  for (const [name, value] of fields) {
    pushText(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    );
  }

  pushText(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
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

  return { boundary, bodyBase64: bytesToBase64(bytes) };
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

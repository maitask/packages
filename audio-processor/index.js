/**
 * @maitask/audio-processor
 * Speech-to-text, translation, audio analysis, and speech synthesis.
 *
 * @version 0.1.0
 * @license MIT
 */

/**
 * @param {Object} input
 * @param {string} [input.audioUrl]
 * @param {string} [input.audioData]
 * @param {string} [input.task] transcribe | translate | analyze | summarize | generate
 * @param {string} [input.prompt]
 * @param {string} [input.language]
 * @param {string} [input.provider] whisper | gemini | openai
 * @param {string} [input.model]
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {Object} context
 * @returns {Object}
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate input
        if (!input.audioUrl && !input.audioData) {
            throw new Error('Either audioUrl or audioData is required');
        }

        // Validate API key
        const apiKey = options.apiKey || options.api_key;
        if (!apiKey) {
            throw new Error('API key is required. Provide via options.apiKey');
        }

        // Get provider, model, and task
        const provider = input.provider || options.provider || 'whisper';
        const task = input.task || options.task || 'transcribe';

        // Handle different providers and tasks
        let result;

        if (
            provider === 'whisper' ||
            (provider === 'openai' && (task === 'transcribe' || task === 'translate'))
        ) {
            result = await processWithWhisper(input, options, apiKey);
        } else if (provider === 'gemini') {
            result = await processWithGemini(input, options, apiKey);
        } else if (provider === 'openai' && task === 'generate') {
            result = await generateAudioWithOpenAI(input, options, apiKey);
        } else {
            throw new Error(`Unsupported provider: ${provider} with task: ${task}`);
        }

        return {
            success: true,
            data: result,
            metadata: {
                provider: provider,
                task: task,
                timestamp: new Date().toISOString(),
                version: '0.1.0'
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
                version: '0.1.0'
            }
        };
    }
}

/**
 * Process audio with OpenAI Whisper API
 */
async function processWithWhisper(input, options, apiKey) {
    const model = input.model || options.model || 'whisper-1';
    const task = input.task || options.task || 'transcribe';

    // Fetch audio file if URL provided
    let audioFile;
    if (input.audioUrl) {
        const audioResponse = await fetch(input.audioUrl);
        const audioBuffer = await audioResponse.arrayBuffer();
        audioFile = new Blob([audioBuffer], { type: 'audio/mpeg' });
    } else if (input.audioData) {
        // Convert base64 to blob
        const binaryString = atob(input.audioData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        audioFile = new Blob([bytes], { type: 'audio/mpeg' });
    }

    // Create form data
    const formData = new FormData();
    formData.append('file', audioFile, 'audio.mp3');
    formData.append('model', model);

    if (input.language) {
        formData.append('language', input.language);
    }

    if (input.prompt) {
        formData.append('prompt', input.prompt);
    }

    if (input.temperature !== undefined) {
        formData.append('temperature', input.temperature.toString());
    }

    if (input.response_format) {
        formData.append('response_format', input.response_format);
    }

    if (input.timestamp_granularities) {
        formData.append('timestamp_granularities', JSON.stringify(input.timestamp_granularities));
    }

    // Call Whisper API
    const endpoint = task === 'translate'
        ? 'https://api.openai.com/v1/audio/translations'
        : 'https://api.openai.com/v1/audio/transcriptions';

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`
        },
        body: formData
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

/**
 * Process audio with Gemini 2.5 native audio
 */
async function processWithGemini(input, options, apiKey) {
    const model = input.model || options.model || 'gemini-2.5-pro';
    const task = input.task || 'analyze';

    // Build prompt based on task
    let prompt;
    if (input.prompt) {
        prompt = input.prompt;
    } else {
        switch (task) {
            case 'transcribe':
                prompt = 'Transcribe this audio exactly as spoken, including all words and punctuation.';
                break;
            case 'analyze':
                prompt = 'Analyze this audio. Describe what you hear, including speech content, tone, emotions, background sounds, and any other notable audio characteristics.';
                break;
            case 'summarize':
                prompt = 'Summarize the main points and key information from this audio.';
                break;
            default:
                prompt = 'Describe what you hear in this audio.';
        }
    }

    // Fetch audio if URL provided
    let audioData = input.audioData;
    if (input.audioUrl && !audioData) {
        const audioResponse = await fetch(input.audioUrl);
        const buffer = await audioResponse.arrayBuffer();
        audioData = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    // Build request for Gemini
    const requestBody = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inlineData: {
                        mimeType: input.mimeType || options.mimeType || 'audio/mpeg',
                        data: audioData
                    }
                }
            ]
        }]
    };

    // Call Gemini API
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

/**
 * Generate audio with OpenAI TTS
 */
async function generateAudioWithOpenAI(input, options, apiKey) {
    const model = input.model || options.model || 'tts-1-hd';
    const voice = input.voice || options.voice || 'alloy';
    const text = input.text || input.prompt;

    if (!text) {
        throw new Error('Text is required for audio generation');
    }

    const requestBody = {
        model: model,
        input: text,
        voice: voice,
        response_format: input.response_format || options.response_format || 'mp3',
        speed: input.speed || options.speed || 1.0
    };

    // Add instruction for gpt-4o-mini-tts model (new 2025 feature)
    if (model === 'gpt-4o-mini-tts' && (input.instruction || options.instruction)) {
        requestBody.instruction = input.instruction || options.instruction;
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI TTS API Error (${response.status}): ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return {
        audioData: audioBase64,
        format: requestBody.response_format,
        model: model,
        voice: voice
    };
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

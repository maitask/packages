/**
 * @maitask/audio-processor
 * Audio processing and transcription using AI models
 *
 * Supports OpenAI Whisper (speech-to-text), Gemini 2.5 native audio (dialog, analysis),
 * and audio generation with AI models.
 *
 * @version 0.1.0
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {string} input.audioUrl - URL of audio file to process
 * @param {string} input.audioData - Base64 encoded audio data
 * @param {string} input.task - Processing task (transcribe, translate, analyze, generate)
 * @param {string} input.prompt - Analysis or generation prompt
 * @param {string} input.language - Audio language (for transcription)
 * @param {string} input.provider - AI provider (whisper, gemini, openai, index-tts, default: whisper)
 * @param {string} input.model - Model name (default depends on provider)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - AI API key
 * @param {Object} context - Execution context
 * @returns {Object} Audio processing result
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

        if (provider === 'whisper' || (provider === 'openai' && task === 'transcribe')) {
            result = await processWithWhisper(input, options, apiKey);
        } else if (provider === 'gemini') {
            result = await processWithGemini(input, options, apiKey);
        } else if (provider === 'openai' && task === 'generate') {
            result = await generateAudioWithOpenAI(input, options, apiKey);
        } else if (provider === 'index-tts' || provider === 'indextts') {
            result = await generateAudioWithIndexTTS(input, options, apiKey);
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

/**
 * Generate audio with Index-TTS (open-source, self-hosted)
 */
async function generateAudioWithIndexTTS(input, options, apiKey) {
    const baseUrl = options.baseUrl || options.base_url || 'http://localhost:8000';
    const text = input.text || input.prompt;

    if (!text) {
        throw new Error('Text is required for audio generation');
    }

    // Build request for Index-TTS API
    const requestBody = {
        text: text,
        language: input.language || options.language || 'zh',
        // Reference audio for voice cloning (base64 or URL)
        reference_audio: input.referenceAudio || input.reference_audio,
        // Emotion control (IndexTTS-2 feature)
        emotion: input.emotion || options.emotion,
        // Duration control mode
        duration_control: input.durationControl || input.duration_control || 'auto',
        // Speed control
        speed: input.speed || options.speed || 1.0,
        // Pinyin for pronunciation control (Chinese)
        pinyin: input.pinyin || options.pinyin
    };

    // Remove undefined values
    Object.keys(requestBody).forEach(key => {
        if (requestBody[key] === undefined) {
            delete requestBody[key];
        }
    });

    const response = await fetch(`${baseUrl}/api/tts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Index-TTS API Error (${response.status}): ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return {
        audioData: audioBase64,
        format: 'wav',
        model: 'index-tts-2',
        language: requestBody.language,
        emotion: requestBody.emotion
    };
}

execute;

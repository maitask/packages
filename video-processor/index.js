/**
 * @maitask/video-processor
 * Video analysis and processing using AI vision models
 *
 * Supports GPT-5 and Gemini 2.5 Pro for video understanding, scene analysis,
 * object detection, transcription, and content summarization.
 *
 * @version 0.1.0
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {string} input.videoUrl - URL of video file to process
 * @param {string} input.videoData - Base64 encoded video data
 * @param {string} input.task - Processing task (describe, analyze, transcribe, summarize, detect)
 * @param {string} input.prompt - Custom analysis prompt
 * @param {string} input.provider - AI provider (openai, gemini, default: gemini)
 * @param {string} input.model - Model name (default depends on provider)
 * @param {number} input.frameRate - Sample frames per second (for frame-based analysis)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - AI API key
 * @param {Object} context - Execution context
 * @returns {Object} Video processing result
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate input
        if (!input.videoUrl && !input.videoData) {
            throw new Error('Either videoUrl or videoData is required');
        }

        // Validate API key
        const apiKey = options.apiKey || options.api_key;
        if (!apiKey) {
            throw new Error('API key is required. Provide via options.apiKey');
        }

        // Get provider, model, and task
        const provider = input.provider || options.provider || 'gemini';
        const model = input.model || options.model || (provider === 'openai' ? 'gpt-5' : 'gemini-2.5-pro');
        const task = input.task || options.task || 'describe';

        // Build analysis prompt based on task
        let analysisPrompt;
        if (input.prompt || options.prompt) {
            analysisPrompt = input.prompt || options.prompt;
        } else {
            switch (task) {
                case 'transcribe':
                    analysisPrompt = 'Transcribe all spoken words in this video. Include timestamps if possible.';
                    break;
                case 'summarize':
                    analysisPrompt = 'Provide a detailed summary of this video, including main topics, key points, and important visual elements.';
                    break;
                case 'detect':
                    analysisPrompt = 'Identify and list all objects, people, actions, and scene changes in this video. Provide timestamps for significant events.';
                    break;
                case 'analyze':
                    analysisPrompt = 'Analyze this video comprehensively. Describe the content, context, visual elements, audio, actions, emotions, and any notable patterns or events.';
                    break;
                case 'describe':
                default:
                    analysisPrompt = 'Describe what is happening in this video in detail. Include visual elements, actions, audio content, and the overall narrative.';
                    break;
            }
        }

        // Fetch video data if URL provided
        let videoData = input.videoData;
        if (input.videoUrl && !videoData) {
            const videoResponse = await fetch(input.videoUrl);
            const buffer = await videoResponse.arrayBuffer();
            videoData = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        }

        // Process video based on provider
        let result;
        if (provider === 'gemini') {
            result = await processWithGemini(videoData, analysisPrompt, model, input, apiKey);
        } else if (provider === 'openai') {
            result = await processWithOpenAI(videoData, analysisPrompt, model, input, apiKey);
        } else {
            throw new Error(`Unsupported provider: ${provider}. Use 'openai' or 'gemini'`);
        }

        return {
            success: true,
            data: result,
            metadata: {
                provider: provider,
                model: model,
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
                code: 'VIDEO_PROCESSOR_ERROR',
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
 * Process video with Gemini 2.5 Pro
 */
async function processWithGemini(videoData, prompt, model, input, apiKey) {
    const mimeType = input.mimeType || input.videoMimeType || 'video/mp4';

    // Build request body
    const requestBody = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: videoData
                    }
                }
            ]
        }]
    };

    // Add generation config if specified
    if (input.temperature !== undefined || input.maxOutputTokens) {
        requestBody.generationConfig = {};
        if (input.temperature !== undefined) {
            requestBody.generationConfig.temperature = input.temperature;
        }
        if (input.maxOutputTokens) {
            requestBody.generationConfig.maxOutputTokens = input.maxOutputTokens;
        }
    }

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
 * Process video with OpenAI GPT-5
 */
async function processWithOpenAI(videoData, prompt, model, input, apiKey) {
    // GPT-5 supports video through multimodal messages
    // Note: As of 2025, video support may be in beta or require specific access

    const mimeType = input.mimeType || input.videoMimeType || 'video/mp4';

    const requestBody = {
        model: model,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                {
                    type: 'video',
                    video: {
                        data: videoData,
                        mime_type: mimeType
                    }
                }
            ]
        }],
        max_tokens: input.maxTokens || input.max_tokens || 2000
    };

    // Add optional parameters
    if (input.temperature !== undefined) {
        requestBody.temperature = input.temperature;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error (${response.status}): ${errorText}`);
    }

    const openaiResult = await response.json();
    const analysisText = openaiResult.choices?.[0]?.message?.content || '';

    return {
        analysis: analysisText,
        usage: openaiResult.usage,
        raw: openaiResult
    };
}

execute;

/**
 * @maitask/gemini
 * Google Gemini AI models integration
 *
 * Supports Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite with generateContent API.
 * Features: Structured output, multimodal inputs, streaming, safety settings.
 *
 * @version 0.1.0
 * @license MIT
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {Array|string} input.contents - Content array or text string
 * @param {string} input.model - Model name (default: gemini-2.5-pro)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - Google AI API key
 * @param {Object} context - Execution context
 * @returns {Object} AI response
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate API key
        const apiKey = options.apiKey || options.api_key || options.GOOGLE_API_KEY;
        if (!apiKey) {
            throw new Error('Google API key is required. Provide via options.apiKey');
        }

        // Get model name
        const model = input.model || options.model || 'gemini-2.5-pro';
        const endpoint = `${API_BASE}/${model}:generateContent`;

        // Build request body
        const requestBody = {};

        // Handle contents - support both array and simple text
        if (input.contents) {
            requestBody.contents = input.contents;
        } else if (input.text || input.prompt) {
            // Simplified text input
            const text = input.text || input.prompt;
            requestBody.contents = [{
                parts: [{ text: text }]
            }];
        } else if (input.messages) {
            // Convert messages format to Gemini format
            requestBody.contents = input.messages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));
        } else {
            throw new Error('Input must contain contents, text, prompt, or messages');
        }

        // Generation config
        const generationConfig = {};

        if (input.temperature !== undefined || options.temperature !== undefined) {
            generationConfig.temperature = input.temperature !== undefined ? input.temperature : options.temperature;
        }

        if (input.maxOutputTokens || input.max_tokens || options.maxOutputTokens || options.max_tokens) {
            generationConfig.maxOutputTokens = input.maxOutputTokens || input.max_tokens || options.maxOutputTokens || options.max_tokens;
        }

        if (input.topP || input.top_p || options.topP || options.top_p) {
            generationConfig.topP = input.topP || input.top_p || options.topP || options.top_p;
        }

        if (input.topK || input.top_k || options.topK || options.top_k) {
            generationConfig.topK = input.topK || input.top_k || options.topK || options.top_k;
        }

        if (input.stopSequences || options.stopSequences) {
            generationConfig.stopSequences = input.stopSequences || options.stopSequences;
        }

        // Response MIME type for structured output
        if (input.responseMimeType || options.responseMimeType) {
            generationConfig.responseMimeType = input.responseMimeType || options.responseMimeType;
        }

        if (Object.keys(generationConfig).length > 0) {
            requestBody.generationConfig = generationConfig;
        }

        // Safety settings
        if (input.safetySettings || options.safetySettings) {
            requestBody.safetySettings = input.safetySettings || options.safetySettings;
        }

        // System instruction
        if (input.systemInstruction || options.systemInstruction) {
            requestBody.systemInstruction = input.systemInstruction || options.systemInstruction;
        }

        // Make API request
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
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message || errorText;
            } catch {
                errorMessage = errorText;
            }
            throw new Error(`Gemini API Error (${response.status}): ${errorMessage}`);
        }

        const result = await response.json();

        // Extract content from response
        const content = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const finishReason = result.candidates?.[0]?.finishReason || '';

        return {
            success: true,
            data: {
                content: content,
                finishReason: finishReason,
                model: model,
                usage: {
                    promptTokens: result.usageMetadata?.promptTokenCount || 0,
                    completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
                    totalTokens: result.usageMetadata?.totalTokenCount || 0
                },
                safetyRatings: result.candidates?.[0]?.safetyRatings || [],
                raw: result
            },
            metadata: {
                provider: 'google',
                timestamp: new Date().toISOString(),
                version: '0.1.0',
                model: model
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message,
                code: 'GEMINI_API_ERROR',
                type: error.constructor.name
            },
            metadata: {
                provider: 'google',
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

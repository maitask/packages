/**
 * @maitask/image-processor
 * Image analysis and processing using AI vision models
 *
 * Analyzes images using multimodal AI models (GPT-5, Claude, Gemini).
 * Supports image description, OCR, object detection, and custom analysis.
 *
 * @version 0.1.0
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {string|Array} input.imageUrl - Image URL or array of URLs
 * @param {string} input.imageData - Base64 encoded image data
 * @param {string} input.task - Analysis task (describe, ocr, detect, custom)
 * @param {string} input.prompt - Custom analysis prompt
 * @param {string} input.model - AI model to use (default: gpt-5)
 * @param {string} input.provider - AI provider (openai, claude, gemini, default: openai)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - AI API key
 * @param {Object} context - Execution context
 * @returns {Object} Image analysis result
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate input
        if (!input.imageUrl && !input.imageData) {
            throw new Error('Either imageUrl or imageData is required');
        }

        // Validate API key
        const apiKey = options.apiKey || options.api_key;
        if (!apiKey) {
            throw new Error('API key is required. Provide via options.apiKey');
        }

        // Get provider and model
        const provider = input.provider || options.provider || 'openai';
        const model = input.model || options.model || (provider === 'openai' ? 'gpt-5' : provider === 'claude' ? 'claude-sonnet-4-5' : 'gemini-2.5-pro');
        const task = input.task || options.task || 'describe';

        // Build analysis prompt based on task
        let analysisPrompt;
        if (input.prompt || options.prompt) {
            analysisPrompt = input.prompt || options.prompt;
        } else {
            switch (task) {
                case 'ocr':
                    analysisPrompt = 'Extract all text from this image. Return the text exactly as it appears, preserving formatting and layout where possible.';
                    break;
                case 'detect':
                    analysisPrompt = 'Identify and list all objects, people, and elements in this image. For each item, provide its location, size, and any relevant details.';
                    break;
                case 'describe':
                default:
                    analysisPrompt = 'Describe this image in detail. Include what you see, the setting, colors, mood, and any notable elements or text.';
                    break;
            }
        }

        // Handle multiple images
        const imageUrls = Array.isArray(input.imageUrl) ? input.imageUrl : (input.imageUrl ? [input.imageUrl] : []);
        const imageData = input.imageData;

        // Call AI API based on provider
        let apiEndpoint, apiHeaders, requestBody;

        if (provider === 'openai') {
            apiEndpoint = 'https://api.openai.com/v1/chat/completions';
            apiHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };

            // Build content array with images
            const content = [{ type: 'text', text: analysisPrompt }];

            if (imageUrls.length > 0) {
                imageUrls.forEach(url => {
                    content.push({
                        type: 'image_url',
                        image_url: { url: url }
                    });
                });
            } else if (imageData) {
                content.push({
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${imageData}` }
                });
            }

            requestBody = {
                model: model,
                messages: [
                    { role: 'user', content: content }
                ],
                max_tokens: 1000
            };
        } else if (provider === 'claude') {
            apiEndpoint = 'https://api.anthropic.com/v1/messages';
            apiHeaders = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            };

            // Build content array with images
            const content = [{ type: 'text', text: analysisPrompt }];

            if (imageUrls.length > 0) {
                // Claude requires base64 data, fetch URLs and convert
                for (const url of imageUrls) {
                    const imgResponse = await fetch(url);
                    const buffer = await imgResponse.arrayBuffer();
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                    content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: base64
                        }
                    });
                }
            } else if (imageData) {
                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/jpeg',
                        data: imageData
                    }
                });
            }

            requestBody = {
                model: model,
                max_tokens: 1024,
                messages: [
                    { role: 'user', content: content }
                ]
            };
        } else if (provider === 'gemini') {
            apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
            apiHeaders = {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            };

            // Build parts array with images
            const parts = [{ text: analysisPrompt }];

            if (imageUrls.length > 0) {
                // Gemini can use URLs or base64
                for (const url of imageUrls) {
                    const imgResponse = await fetch(url);
                    const buffer = await imgResponse.arrayBuffer();
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                    parts.push({
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: base64
                        }
                    });
                }
            } else if (imageData) {
                parts.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: imageData
                    }
                });
            }

            requestBody = {
                contents: [{ parts: parts }]
            };
        } else {
            throw new Error(`Unsupported provider: ${provider}. Use 'openai', 'claude', or 'gemini'`);
        }

        // Make API request
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error (${response.status}): ${errorText}`);
        }

        const result = await response.json();

        // Extract content based on provider
        let analysis;
        if (provider === 'openai') {
            analysis = result.choices?.[0]?.message?.content || '';
        } else if (provider === 'claude') {
            analysis = result.content?.[0]?.text || '';
        } else if (provider === 'gemini') {
            analysis = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        return {
            success: true,
            data: {
                analysis: analysis,
                task: task,
                imageCount: imageUrls.length > 0 ? imageUrls.length : 1,
                raw: result
            },
            metadata: {
                provider: provider,
                model: model,
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message,
                code: 'IMAGE_PROCESSOR_ERROR',
                type: error.constructor.name
            },
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

/**
 * @maitask/text-summary
 * Text summarization using AI models
 *
 * Generates concise summaries of long texts using AI models (OpenAI, Claude, etc.).
 * Supports different summary styles and lengths.
 *
 * @version 0.1.0
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {string|Array} input.text - Text to summarize (string or array of strings)
 * @param {string} input.model - AI model to use (default: gpt-4)
 * @param {string} input.provider - AI provider (openai, claude, gemini, default: openai)
 * @param {string} input.style - Summary style (concise, detailed, bullet, default: concise)
 * @param {number} input.maxLength - Max summary length in words (default: 100)
 * @param {string} input.language - Output language (default: auto-detect)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - AI API key
 * @param {Object} context - Execution context
 * @returns {Object} Summarization result
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate input
        if (!input.text) {
            throw new Error('Input text is required');
        }

        // Validate API key
        const apiKey = options.apiKey || options.api_key;
        if (!apiKey) {
            throw new Error('API key is required. Provide via options.apiKey');
        }

        // Get provider and model
        const provider = input.provider || options.provider || 'openai';
        const model = input.model || options.model || (provider === 'openai' ? 'gpt-4' : 'claude-3-5-sonnet-20241022');
        const style = input.style || options.style || 'concise';
        const maxLength = input.maxLength || input.max_length || options.maxLength || 100;
        const language = input.language || options.language || 'auto-detect';

        // Handle array of texts
        const texts = Array.isArray(input.text) ? input.text : [input.text];

        // Build summary prompt based on style
        let styleInstruction;
        switch (style) {
            case 'bullet':
                styleInstruction = 'Provide a bullet-point summary with key points.';
                break;
            case 'detailed':
                styleInstruction = 'Provide a comprehensive summary covering all main topics and important details.';
                break;
            case 'concise':
            default:
                styleInstruction = 'Provide a brief, concise summary of the main points.';
                break;
        }

        const systemPrompt = `You are an expert at summarizing text. ${styleInstruction}
Maximum length: ${maxLength} words.
Language: ${language === 'auto-detect' ? 'same as input text' : language}.
Return only the summary text, no additional commentary.`;

        const userPrompt = texts.length === 1
            ? `Summarize this text:\n\n${texts[0]}`
            : `Summarize each of these texts:\n\n${texts.map((t, i) => `Text ${i + 1}:\n${t}`).join('\n\n')}`;

        // Call AI API based on provider
        let apiEndpoint, apiHeaders, requestBody;

        if (provider === 'openai') {
            apiEndpoint = 'https://api.openai.com/v1/chat/completions';
            apiHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
            requestBody = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.5,
                max_tokens: Math.max(maxLength * 2, 500)
            };
        } else if (provider === 'claude') {
            apiEndpoint = 'https://api.anthropic.com/v1/messages';
            apiHeaders = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            };
            requestBody = {
                model: model,
                max_tokens: Math.max(maxLength * 2, 500),
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.5
            };
        } else if (provider === 'gemini') {
            apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
            apiHeaders = {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            };
            requestBody = {
                contents: [{
                    parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
                }],
                generationConfig: {
                    temperature: 0.5,
                    maxOutputTokens: Math.max(maxLength * 2, 500)
                }
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
        let summary;
        if (provider === 'openai') {
            summary = result.choices?.[0]?.message?.content || '';
        } else if (provider === 'claude') {
            summary = result.content?.[0]?.text || '';
        } else if (provider === 'gemini') {
            summary = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        // Calculate word count
        const wordCount = summary.split(/\s+/).filter(w => w.length > 0).length;

        return {
            success: true,
            data: {
                summary: summary,
                wordCount: wordCount,
                style: style,
                inputCount: texts.length,
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
                code: 'TEXT_SUMMARY_ERROR',
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

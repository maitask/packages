/**
 * @maitask/sentiment-analysis
 * Text sentiment analysis using AI models
 *
 * Analyzes sentiment of text using AI models (OpenAI, Claude, etc.).
 * Returns sentiment classification, confidence scores, and emotional insights.
 *
 * @version 0.1.0
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {string|Array} input.text - Text to analyze (string or array of strings)
 * @param {string} input.model - AI model to use (default: gpt-4)
 * @param {string} input.provider - AI provider (openai, claude, gemini, default: openai)
 * @param {boolean} input.detailed - Return detailed analysis (default: false)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - AI API key
 * @param {Object} context - Execution context
 * @returns {Object} Sentiment analysis result
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
        const detailed = input.detailed || options.detailed || false;

        // Handle array of texts
        const texts = Array.isArray(input.text) ? input.text : [input.text];

        // Build analysis prompt
        const analysisType = detailed ? 'detailed sentiment analysis with emotional insights' : 'sentiment classification';
        const systemPrompt = `You are a sentiment analysis expert. Analyze the following text and provide a ${analysisType}.

For each text, provide:
1. sentiment: "positive", "negative", or "neutral"
2. confidence: 0-1 score
${detailed ? '3. emotions: array of detected emotions (joy, sadness, anger, fear, surprise, disgust)\n4. aspects: key aspects and their sentiments\n5. reasoning: brief explanation' : ''}

Return JSON format only.`;

        const userPrompt = texts.length === 1
            ? `Text: "${texts[0]}"`
            : `Texts:\n${texts.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`;

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
                response_format: { type: 'json_object' },
                temperature: 0.3
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
                max_tokens: 1024,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3
            };
        } else {
            throw new Error(`Unsupported provider: ${provider}. Use 'openai' or 'claude'`);
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
        let content;
        if (provider === 'openai') {
            content = result.choices?.[0]?.message?.content || '';
        } else if (provider === 'claude') {
            content = result.content?.[0]?.text || '';
        }

        // Parse JSON response
        const analysis = JSON.parse(content);

        return {
            success: true,
            data: {
                analysis: analysis,
                inputCount: texts.length,
                detailed: detailed,
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
                code: 'SENTIMENT_ANALYSIS_ERROR',
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

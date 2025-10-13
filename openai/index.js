/**
 * @maitask/openai
 * OpenAI GPT models integration
 *
 * Supports GPT-5, GPT-4, GPT-4-turbo, GPT-3.5-turbo with chat completions API.
 * Features: JSON mode, streaming, function calling, temperature control.
 *
 * @version 0.1.0
 * @license MIT
 */

const API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {Array} input.messages - Chat messages array (text or multimodal with images)
 * @param {string} input.text - Simple text input (alternative to messages)
 * @param {string} input.model - Model name (default: gpt-5)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - OpenAI API key
 * @param {Object} context - Execution context
 * @returns {Object} AI response
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate API key
        const apiKey = options.apiKey || options.api_key || options.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OpenAI API key is required. Provide via options.apiKey');
        }

        // Process messages - support text-only and multimodal content
        let messages = input.messages || [];
        if (input.text || input.prompt) {
            // Simple text input
            messages = [{ role: 'user', content: input.text || input.prompt }];
        }

        // Build request body
        const requestBody = {
            model: input.model || options.model || 'gpt-5',
            messages: messages,
            temperature: input.temperature !== undefined ? input.temperature : (options.temperature !== undefined ? options.temperature : 0.7),
            max_tokens: input.maxTokens || input.max_tokens || options.maxTokens || options.max_tokens || 1000,
        };

        // Optional parameters
        if (input.top_p !== undefined || options.top_p !== undefined) {
            requestBody.top_p = input.top_p !== undefined ? input.top_p : options.top_p;
        }

        if (input.frequency_penalty !== undefined || options.frequency_penalty !== undefined) {
            requestBody.frequency_penalty = input.frequency_penalty !== undefined ? input.frequency_penalty : options.frequency_penalty;
        }

        if (input.presence_penalty !== undefined || options.presence_penalty !== undefined) {
            requestBody.presence_penalty = input.presence_penalty !== undefined ? input.presence_penalty : options.presence_penalty;
        }

        // JSON mode
        if (input.jsonMode || input.json_mode || options.jsonMode || options.json_mode) {
            requestBody.response_format = { type: 'json_object' };
        }

        // Stream mode
        const stream = input.stream || options.stream || false;
        requestBody.stream = stream;

        // Function calling
        if (input.functions || options.functions) {
            requestBody.functions = input.functions || options.functions;
        }

        if (input.function_call || options.function_call) {
            requestBody.function_call = input.function_call || options.function_call;
        }

        // Tools (newer function calling format)
        if (input.tools || options.tools) {
            requestBody.tools = input.tools || options.tools;
        }

        if (input.tool_choice || options.tool_choice) {
            requestBody.tool_choice = input.tool_choice || options.tool_choice;
        }

        // Make API request
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
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
            throw new Error(`OpenAI API Error (${response.status}): ${errorMessage}`);
        }

        const result = await response.json();

        // Extract content
        const content = result.choices?.[0]?.message?.content || '';
        const finishReason = result.choices?.[0]?.finish_reason || '';

        return {
            success: true,
            data: {
                content: content,
                finishReason: finishReason,
                model: result.model,
                usage: {
                    promptTokens: result.usage?.prompt_tokens || 0,
                    completionTokens: result.usage?.completion_tokens || 0,
                    totalTokens: result.usage?.total_tokens || 0
                },
                raw: result
            },
            metadata: {
                provider: 'openai',
                timestamp: new Date().toISOString(),
                version: '0.1.0',
                model: result.model
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message,
                code: 'OPENAI_API_ERROR',
                type: error.constructor.name
            },
            metadata: {
                provider: 'openai',
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

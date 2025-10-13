/**
 * @maitask/deepseek
 * DeepSeek AI models integration
 *
 * Supports DeepSeek-V3.2-Exp with chat and reasoning modes.
 * Features: Chain of thought reasoning, JSON mode, function calling, OpenAI compatibility.
 *
 * @version 0.1.0
 * @license MIT
 */

const API_ENDPOINT = 'https://api.deepseek.com/chat/completions';

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {Array} input.messages - Chat messages array
 * @param {string} input.model - Model name (default: deepseek-chat)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - DeepSeek API key
 * @param {Object} context - Execution context
 * @returns {Object} AI response
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate API key
        const apiKey = options.apiKey || options.api_key || options.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw new Error('DeepSeek API key is required. Provide via options.apiKey');
        }

        // Get model (deepseek-chat or deepseek-reasoner)
        const model = input.model || options.model || 'deepseek-chat';
        const isReasoningModel = model.includes('reasoner');

        // Build request body
        const requestBody = {
            model: model,
            messages: input.messages || []
        };

        // Temperature and top_p - not supported by deepseek-reasoner
        if (!isReasoningModel) {
            if (input.temperature !== undefined || options.temperature !== undefined) {
                requestBody.temperature = input.temperature !== undefined ? input.temperature : options.temperature;
            }

            if (input.top_p !== undefined || options.top_p !== undefined) {
                requestBody.top_p = input.top_p !== undefined ? input.top_p : options.top_p;
            }

            if (input.frequency_penalty !== undefined || options.frequency_penalty !== undefined) {
                requestBody.frequency_penalty = input.frequency_penalty !== undefined ? input.frequency_penalty : options.frequency_penalty;
            }

            if (input.presence_penalty !== undefined || options.presence_penalty !== undefined) {
                requestBody.presence_penalty = input.presence_penalty !== undefined ? input.presence_penalty : options.presence_penalty;
            }
        }

        // Max tokens
        if (input.max_tokens || input.maxTokens || options.max_tokens || options.maxTokens) {
            requestBody.max_tokens = input.max_tokens || input.maxTokens || options.max_tokens || options.maxTokens;
        }

        // Stream mode
        const stream = input.stream || options.stream || false;
        requestBody.stream = stream;

        // Stop sequences
        if (input.stop || options.stop) {
            requestBody.stop = input.stop || options.stop;
        }

        // JSON mode
        if (input.jsonMode || input.json_mode || options.jsonMode || options.json_mode) {
            requestBody.response_format = { type: 'json_object' };
        }

        // Function calling / Tools
        if (input.functions || options.functions) {
            requestBody.functions = input.functions || options.functions;
        }

        if (input.function_call || options.function_call) {
            requestBody.function_call = input.function_call || options.function_call;
        }

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
            throw new Error(`DeepSeek API Error (${response.status}): ${errorMessage}`);
        }

        const result = await response.json();

        // Extract content
        const message = result.choices?.[0]?.message || {};
        const content = message.content || '';
        const reasoningContent = message.reasoning_content || null; // For deepseek-reasoner
        const finishReason = result.choices?.[0]?.finish_reason || '';

        return {
            success: true,
            data: {
                content: content,
                reasoningContent: reasoningContent,
                finishReason: finishReason,
                model: result.model,
                usage: {
                    promptTokens: result.usage?.prompt_tokens || 0,
                    completionTokens: result.usage?.completion_tokens || 0,
                    totalTokens: result.usage?.total_tokens || 0,
                    promptCacheHitTokens: result.usage?.prompt_cache_hit_tokens || 0,
                    promptCacheMissTokens: result.usage?.prompt_cache_miss_tokens || 0
                },
                raw: result
            },
            metadata: {
                provider: 'deepseek',
                timestamp: new Date().toISOString(),
                version: '0.1.0',
                model: result.model,
                reasoningMode: isReasoningModel
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message,
                code: 'DEEPSEEK_API_ERROR',
                type: error.constructor.name
            },
            metadata: {
                provider: 'deepseek',
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

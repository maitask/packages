/**
 * @maitask/ollama
 * Ollama local AI models integration
 *
 * Supports Llama, Mistral, Phi and other open-source models running locally.
 * Features: Native API, OpenAI compatibility, streaming, JSON format output.
 *
 * @version 0.1.0
 * @license MIT
 */

const OLLAMA_API = 'http://localhost:11434/api/chat';
const OLLAMA_OPENAI_API = 'http://localhost:11434/v1/chat/completions';

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {Array} input.messages - Chat messages array
 * @param {string} input.model - Model name (e.g., llama3.2, mistral)
 * @param {Object} options - API configuration
 * @param {string} options.baseUrl - Ollama server URL (default: http://localhost:11434)
 * @param {boolean} options.openaiCompat - Use OpenAI-compatible endpoint (default: false)
 * @param {Object} context - Execution context
 * @returns {Object} AI response
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Get base URL (default to localhost)
        const baseUrl = options.baseUrl || options.base_url || 'http://localhost:11434';

        // Determine endpoint type
        const useOpenAI = options.openaiCompat || options.openai_compat || false;
        const endpoint = useOpenAI
            ? `${baseUrl}/v1/chat/completions`
            : `${baseUrl}/api/chat`;

        // Build request body
        const requestBody = {
            model: input.model || options.model || 'llama3.2',
            messages: input.messages || [],
            stream: input.stream || options.stream || false
        };

        // Optional parameters
        if (input.temperature !== undefined || options.temperature !== undefined) {
            requestBody.temperature = input.temperature !== undefined ? input.temperature : options.temperature;
        }

        if (input.top_p !== undefined || options.top_p !== undefined) {
            requestBody.top_p = input.top_p !== undefined ? input.top_p : options.top_p;
        }

        if (input.top_k !== undefined || options.top_k !== undefined) {
            requestBody.top_k = input.top_k !== undefined ? input.top_k : options.top_k;
        }

        if (input.max_tokens || input.num_predict || options.max_tokens || options.num_predict) {
            const maxTokens = input.max_tokens || input.num_predict || options.max_tokens || options.num_predict;
            if (useOpenAI) {
                requestBody.max_tokens = maxTokens;
            } else {
                requestBody.options = requestBody.options || {};
                requestBody.options.num_predict = maxTokens;
            }
        }

        // JSON format mode
        if (input.jsonMode || input.json_mode || options.jsonMode || options.json_mode) {
            requestBody.format = 'json';
        }

        // Ollama-specific options
        if (input.options || options.options) {
            requestBody.options = {
                ...requestBody.options,
                ...(input.options || options.options)
            };
        }

        // Make API request
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message || errorJson.error || errorText;
            } catch {
                errorMessage = errorText;
            }
            throw new Error(`Ollama API Error (${response.status}): ${errorMessage}`);
        }

        const result = await response.json();

        // Extract content based on endpoint type
        let content, finishReason, usage;

        if (useOpenAI) {
            // OpenAI-compatible format
            content = result.choices?.[0]?.message?.content || '';
            finishReason = result.choices?.[0]?.finish_reason || '';
            usage = {
                promptTokens: result.usage?.prompt_tokens || 0,
                completionTokens: result.usage?.completion_tokens || 0,
                totalTokens: result.usage?.total_tokens || 0
            };
        } else {
            // Native Ollama format
            content = result.message?.content || '';
            finishReason = result.done ? 'stop' : 'incomplete';
            usage = {
                promptTokens: result.prompt_eval_count || 0,
                completionTokens: result.eval_count || 0,
                totalTokens: (result.prompt_eval_count || 0) + (result.eval_count || 0)
            };
        }

        return {
            success: true,
            data: {
                content: content,
                finishReason: finishReason,
                model: result.model || requestBody.model,
                usage: usage,
                loadDuration: result.load_duration,
                totalDuration: result.total_duration,
                raw: result
            },
            metadata: {
                provider: 'ollama',
                timestamp: new Date().toISOString(),
                version: '0.1.0',
                model: result.model || requestBody.model,
                endpoint: useOpenAI ? 'openai-compat' : 'native'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message,
                code: 'OLLAMA_API_ERROR',
                type: error.constructor.name
            },
            metadata: {
                provider: 'ollama',
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

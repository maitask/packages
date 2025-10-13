/**
 * @maitask/claude
 * Anthropic Claude AI models integration
 *
 * Supports Claude Sonnet 4.5, Claude Opus 4.1, Claude 3.5 Sonnet with Messages API.
 * Features: System prompts, multimodal inputs, streaming, temperature control.
 *
 * @version 0.1.0
 * @license MIT
 */

const API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Main execution function
 * @param {Object} input - Input configuration
 * @param {Array} input.messages - Chat messages array (text or multimodal with images)
 * @param {string} input.text - Simple text input (alternative to messages)
 * @param {string} input.model - Model name (default: claude-sonnet-4-5)
 * @param {string|Array} input.system - System prompt
 * @param {number} input.maxTokens - Maximum tokens to generate (required)
 * @param {Object} options - API configuration
 * @param {string} options.apiKey - Anthropic API key
 * @param {Object} context - Execution context
 * @returns {Object} AI response
 */
async function execute(input, options = {}, context = {}) {
    try {
        // Validate API key
        const apiKey = options.apiKey || options.api_key || options.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('Anthropic API key is required. Provide via options.apiKey');
        }

        // Validate max_tokens (required by Anthropic)
        const maxTokens = input.maxTokens || input.max_tokens || options.maxTokens || options.max_tokens;
        if (!maxTokens) {
            throw new Error('max_tokens is required for Claude API. Provide via input.maxTokens');
        }

        // Process messages - support text-only and multimodal content
        let messages = input.messages || [];
        if (input.text || input.prompt) {
            // Simple text input
            messages = [{ role: 'user', content: input.text || input.prompt }];
        }

        // Build request body
        const requestBody = {
            model: input.model || options.model || 'claude-sonnet-4-5',
            max_tokens: maxTokens,
            messages: messages
        };

        // System prompt (separate from messages)
        if (input.system || options.system) {
            requestBody.system = input.system || options.system;
        }

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

        // Stream mode
        const stream = input.stream || options.stream || false;
        requestBody.stream = stream;

        // Stop sequences
        if (input.stop_sequences || options.stop_sequences) {
            requestBody.stop_sequences = input.stop_sequences || options.stop_sequences;
        }

        // Metadata
        if (input.metadata || options.metadata) {
            requestBody.metadata = input.metadata || options.metadata;
        }

        // Make API request
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': API_VERSION
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
            throw new Error(`Claude API Error (${response.status}): ${errorMessage}`);
        }

        const result = await response.json();

        // Extract content
        const content = result.content?.[0]?.text || '';
        const stopReason = result.stop_reason || '';

        return {
            success: true,
            data: {
                content: content,
                stopReason: stopReason,
                model: result.model,
                usage: {
                    inputTokens: result.usage?.input_tokens || 0,
                    outputTokens: result.usage?.output_tokens || 0,
                    totalTokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0)
                },
                raw: result
            },
            metadata: {
                provider: 'anthropic',
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
                code: 'CLAUDE_API_ERROR',
                type: error.constructor.name
            },
            metadata: {
                provider: 'anthropic',
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

/**
 * @maitask/stream-publisher
 * Publish data streams via HTTP chunked transfer or Server-Sent Events
 *
 * Features:
 * - HTTP chunked transfer encoding (line-delimited JSON)
 * - Server-Sent Events (SSE) format
 * - Real-time data streaming
 * - Custom headers and authentication
 * - Configurable chunk sizes
 * - Event naming for SSE
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for stream publishing
 * @param {Object|Array} input - Data to stream
 * @param {Object} options - Streaming options
 * @param {Object} context - Execution context
 * @returns {Object} Stream configuration for the engine's HTTP Stream adapter
 */
function execute(input, options = {}, context = {}) {
    try {
        // Validate input
        if (!input) {
            throw new Error('Input data is required for streaming');
        }

        // Ensure data is array for streaming
        const data = Array.isArray(input) ? input : [input];

        if (data.length === 0) {
            throw new Error('Input data is empty');
        }

        // Build streaming configuration
        const config = {
            url: options.url || options.endpoint,
            mode: options.mode || 'chunked',
            headers: options.headers || {},
            chunk_size: options.chunk_size || options.chunkSize || 65536,
            timeout_seconds: options.timeout_seconds || options.timeout || 300,
            event_name: options.event_name || options.eventName || 'message',
            include_response_body: options.include_response_body !== false
        };

        // Validate required fields
        if (!config.url) {
            throw new Error('Stream endpoint URL is required (options.url)');
        }

        // Validate mode
        if (!['chunked', 'sse'].includes(config.mode)) {
            throw new Error('Stream mode must be "chunked" or "sse"');
        }

        // Add authentication if provided
        if (options.auth_token || options.authToken) {
            config.headers['Authorization'] = `Bearer ${options.auth_token || options.authToken}`;
        }

        // Set content type based on mode
        if (config.mode === 'sse') {
            config.headers['Accept'] = 'text/event-stream';
        } else {
            config.headers['Content-Type'] = config.headers['Content-Type'] || 'application/x-ndjson';
        }

        // Structure stream data
        const streamData = prepareStreamData(data, config.mode);

        // Return streaming configuration for the engine's HTTP Stream adapter
        return {
            success: true,
            publisher: 'stream',
            mode: config.mode,
            format: config.mode === 'sse' ? 'text/event-stream' : 'application/x-ndjson',
            output_adapter: {
                adapter: 'http_stream',
                config: config,
                data: streamData
            },
            preview: {
                eventCount: streamData.length,
                totalSize: estimateStreamSize(streamData),
                sample: streamData.slice(0, 3)
            },
            statistics: {
                totalEvents: streamData.length,
                estimatedBytes: estimateStreamSize(streamData),
                chunkSize: config.chunk_size,
                mode: config.mode
            },
            metadata: {
                endpoint: config.url,
                mode: config.mode,
                eventName: config.event_name,
                hasAuth: !!config.headers['Authorization'],
                publishedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown stream publishing error',
                code: 'STREAM_PUBLISH_ERROR',
                type: 'StreamPublishError'
            },
            metadata: {
                publishedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

/**
 * Prepare data for streaming based on mode
 */
function prepareStreamData(data, mode) {
    if (mode === 'sse') {
        // SSE requires structured events
        return data.map((item, index) => ({
            id: index + 1,
            data: item,
            type: 'event'
        }));
    }

    // Chunked mode uses raw data
    return data;
}

/**
 * Estimate total stream size in bytes
 */
function estimateStreamSize(data) {
    return data.reduce((sum, item) => {
        const json = JSON.stringify(item);
        return sum + json.length + 1; // +1 for newline
    }, 0);
}

execute;

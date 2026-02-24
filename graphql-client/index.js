/**
 * @maitask/graphql-client
 * GraphQL query/mutation execution over HTTP
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const url = readRequiredString(payload.url, 'url');
    const query = readRequiredString(payload.query, 'query');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const requestBody = {
      query,
      variables: asObjectOrDefault(payload.variables, {})
    };

    const result = await fetchJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...asHeaders(payload.headers)
      },
      body: requestBody,
      timeoutMs
    });

    const errors = Array.isArray(result.errors) ? result.errors : [];
    const hasData = result.data != null;

    if (errors.length > 0) {
      return {
        success: false,
        data: {
          data: hasData ? result.data : null,
          errors,
          extensions: result.extensions || null
        },
        error: {
          message: 'GraphQL responded with one or more errors',
          code: 'GRAPHQL_RESPONSE_ERROR',
          type: 'GraphQLResponseError'
        },
        metadata: {
          url,
          timestamp: new Date().toISOString(),
          version: '0.1.0'
        }
      };
    }

    return {
      success: true,
      data: {
        data: hasData ? result.data : null,
        errors: [],
        extensions: result.extensions || null
      },
      metadata: {
        url,
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'GRAPHQL_CLIENT_ERROR', 'GraphQLClientError');
  }
}

execute;

async function fetchJson(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    const json = tryParseJson(text);

    if (!response.ok) {
      throw new Error(json?.errors?.[0]?.message || json?.message || text || `Request failed with status ${response.status}`);
    }

    if (json == null) {
      throw new Error('GraphQL response is not valid JSON');
    }

    return json;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('input must be an object');
  }
  return value;
}

function asObjectOrDefault(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('variables must be an object');
  }
  return value;
}

function asHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const headers = {};
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    headers[key] = String(item);
  }
  return headers;
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readRequiredString(value, key) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new Error(`${key} is required`);
  return text;
}

function readTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return 30000;
  return Math.min(timeout, 120000);
}

function buildError(error, code, type) {
  return {
    success: false,
    error: {
      message: error?.message || 'Unknown error',
      code,
      type
    },
    metadata: {
      timestamp: new Date().toISOString(),
      version: '0.1.0'
    }
  };
}

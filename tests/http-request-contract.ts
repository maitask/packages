import {
  execute,
  type HttpJsonValue,
  type HttpRequestInput,
  type HttpRequestOptions,
  type HttpRequestResult
} from '../http-request';

const options = {
  timeoutMs: 30_000,
  maxResponseBytes: 8 * 1024 * 1024,
  maxRedirects: 5,
  allowedHosts: ['api.example.com'],
  secrets: { API_TOKEN: 'configured-secret' }
} as const satisfies HttpRequestOptions;

const input = {
  url: 'https://api.example.com/v1/resources',
  method: 'POST',
  query: { include: ['owner', 'labels'], page: 1 },
  headers: { Accept: 'application/json', 'X-Trace-Id': 'trace-1' },
  auth: { type: 'bearer', tokenSecret: 'API_TOKEN' },
  json: { name: 'Production resource', enabled: true },
  responseType: 'json',
  acceptedStatuses: [200, 201],
  redirect: 'error',
  retry: { maxAttempts: 1 }
} as const satisfies HttpRequestInput;

const result: Promise<HttpRequestResult<HttpJsonValue | null>> = execute(input, options, {
  executionId: 'execution-1'
});

execute({
  url: 'https://api.example.com/artifact',
  method: 'PUT',
  bodyBase64: 'AP9B',
  responseType: 'base64',
  retry: { maxAttempts: 1 }
}, options);

execute({
  url: 'https://api.example.com/upload',
  method: 'POST',
  multipart: {
    name: 'artifact',
    labels: ['production', 'runtime'],
    file: {
      filename: 'artifact.bin',
      contentType: 'application/octet-stream',
      bodyBase64: 'AP9B'
    }
  }
}, options);

execute({
  url: 'https://api.example.com/health',
  method: 'GET',
  acceptedStatusRange: { min: 200, max: 399 },
  retry: { maxAttempts: 5, jitterRatio: 0.2 }
}, options);

result.then(value => {
  if (value.success) {
    const body: HttpJsonValue | null = value.data.items[0].data.body;
    const bytes: number = value.data.items[0].data.bodyBytes;
    const attempts: number = value.metadata.attempts;
    void [body, bytes, attempts];

    // @ts-expect-error response data is readonly
    value.data.items[0].data.bodyBytes = 0;
  } else {
    const code: string = value.error.code;
    void code;
  }
});

// @ts-expect-error string input was removed by the formal contract
execute('https://api.example.com/resource', options);

// @ts-expect-error legacy response_type aliases are not supported
execute({ url: 'https://api.example.com/resource', response_type: 'json' }, options);

// @ts-expect-error literal bearer credentials are not accepted
execute({ url: 'https://api.example.com/resource', auth: { type: 'bearer', token: 'secret' } }, options);

// @ts-expect-error GET requests cannot carry bodies
execute({ url: 'https://api.example.com/resource', method: 'GET', text: 'invalid' }, options);

// @ts-expect-error body representations are mutually exclusive
execute({ url: 'https://api.example.com/resource', method: 'POST', text: 'one', json: { two: true } }, options);

// @ts-expect-error unsafe methods cannot be configured for replay
execute({ url: 'https://api.example.com/resource', method: 'POST', retry: { maxAttempts: 2 } }, options);

execute({
  url: 'https://api.example.com/resource',
  // @ts-expect-error authorization must use the secret-backed auth contract
  headers: { Authorization: 'Bearer caller-secret' }
}, options);

// @ts-expect-error accepted status list and range are mutually exclusive
execute({
  url: 'https://api.example.com/resource',
  acceptedStatuses: [200],
  acceptedStatusRange: { min: 200, max: 299 }
}, options);

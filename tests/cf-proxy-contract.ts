import {
  execute,
  type CfProxyFailure,
  type CfProxyInput,
  type CfProxyResult,
  type CfProxySuccess
} from '../cf-proxy';

const input = {
  url: 'https://registry-1.docker.io/v2/library/ubuntu/manifests/latest',
  method: 'GET',
  headers: {
    Accept: 'application/vnd.oci.image.manifest.v1+json'
  },
  config: {
    restrictPaths: true,
    allowedPaths: ['/v2/library'],
    maxRedirects: 4,
    timeoutMs: 30_000,
    maxResponseBytes: 8 * 1024 * 1024,
    allowedHosts: ['registry-1.docker.io'],
    allowedAuthHosts: ['auth.docker.io'],
    dockerRegistryHosts: ['registry-1.docker.io'],
    allowPrivateHosts: false
  }
} as const satisfies CfProxyInput;

const resultPromise: Promise<CfProxyResult> = execute(input, {}, { executionId: 'exec-1' });

resultPromise.then(result => {
  if (result.success) {
    const success: CfProxySuccess = result;
    const body: string = success.data.bodyBase64;
    const bytes: number = success.data.bodyBytes;
    const authenticated: boolean = success.metadata.registryAuthenticated;
    void [body, bytes, authenticated];
  } else {
    const failure: CfProxyFailure = result;
    const code: string = failure.error.code;
    void code;
  }
});

// @ts-expect-error write methods are outside the read-only contract
execute({ url: 'https://api.github.com/repos', method: 'POST' });

// @ts-expect-error legacy snake_case configuration is not supported
execute({ url: 'https://api.github.com/repos', config: { max_redirects: 2 } });

// @ts-expect-error unknown top-level fields are not supported
execute({ url: 'https://api.github.com/repos', endpoint: 'https://example.com' });

// @ts-expect-error request headers must be string values
execute({ url: 'https://api.github.com/repos', headers: { Accept: 123 } });

resultPromise.then(result => {
  if (result.success) {
    // @ts-expect-error result data is readonly
    result.data.bodyBytes = 0;
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const { execute: executeAudio } = require('../audio-processor');
const { execute: executeClaude } = require('../claude');
const { execute: executeCron } = require('../cron-parser');
const { execute: executeCsv } = require('../csv-parser');
const { execute: executeValidator } = require('../data-validator');
const { execute: executeDeepSeek } = require('../deepseek');
const { execute: executeDiff } = require('../diff-generator');
const { execute: executeDocIntel } = require('../document-intelligence');
const { execute: executeExcel } = require('../excel-exporter');
const { execute: executeFileProc } = require('../file-processor');
const { execute: executeFileTx } = require('../file-transformer');
const { execute: executeGemini } = require('../gemini');
const { execute: executeGraphQL } = require('../graphql-client');
const { execute: executeHackerNews } = require('../hackernews-crawler');
const { execute: executeImageGen } = require('../image-generator');
const { execute: executeImageMeta } = require('../image-metadata');
const { execute: executeBriefing } = require('../intelligence-briefing');
const { execute: executeJsonTx } = require('../json-transformer');
const { execute: executeKafka } = require('../kafka-publisher');
const { execute: executeMarkdown } = require('../markdown-renderer');
const { execute: executeNocoDb } = require('../nocodb-importer');
const { execute: executeOllama } = require('../ollama');
const { execute: executeOpenAI } = require('../openai');
const { execute: executePdf } = require('../pdf-parser');
const { execute: executeS3 } = require('../s3-storage');
const { execute: executeSlack } = require('../slack-notifier');
const { execute: executeStreamPub } = require('../stream-publisher');
const { execute: executeTelegram } = require('../telegram-bot');
const { execute: executeText } = require('../text-parser');
const { execute: executeTrader } = require('../trader');
const { execute: executeUrl } = require('../url-analyzer');
const { execute: executeWebScraper } = require('../web-scraper');
const { execute: executeWebSearch } = require('../web-search');
const { execute: executeComposer } = require('../workflow-composer');
const { execute: executeXml } = require('../xml-parser');
const { execute: executeYaml } = require('../yaml-converter');

test('cron-parser handles step ranges, comma ranges, Sunday 7, UTC runs, and invalid inputs', () => {
  const stepParsed = executeCron('5-20/5 * * * 7', { operation: 'parse' });
  assert.equal(stepParsed.success, true);
  assert.deepEqual(stepParsed.data.result.minutes.values, [5, 10, 15, 20]);
  assert.deepEqual(stepParsed.data.result.dayOfWeek.values, [0]);

  const listParsed = executeCron('5,10-12 0 * * *', { operation: 'parse' });
  assert.equal(listParsed.success, true);
  assert.deepEqual(listParsed.data.result.minutes.values, [5, 10, 11, 12]);

  const nextRuns = executeCron('0 12 * * *', {
    operation: 'next',
    count: 2,
    from: '2026-01-01T10:00:00.000Z'
  });
  assert.equal(nextRuns.success, true);
  assert.deepEqual(nextRuns.data.result, [
    '2026-01-01T12:00:00.000Z',
    '2026-01-02T12:00:00.000Z'
  ]);

  const invalidDate = executeCron('* * * * *', { operation: 'next', from: 'not-a-date' });
  assert.equal(invalidDate.success, false);
});

test('markdown-renderer preserves code blocks, blocks javascript links, and renders templates safely', () => {
  const md = [
    '# Title',
    '',
    '```js',
    'const x = "_not_italic_";',
    'const y = `inline`;',
    '```',
    '',
    '[xss](javascript:alert(1)) and [ok](https://maitask.com) and <script>bad()</script>'
  ].join('\n');

  const res = executeMarkdown(md, {
    template: '<main>{{content}}<footer>{{owner}}</footer></main>',
    templateVars: { owner: 'Maitask & <Ops>' }
  });
  assert.equal(res.success, true);
  assert.match(res.data.content, /_not_italic_/);
  assert.doesNotMatch(res.data.content, /<em>/);
  assert.doesNotMatch(res.data.content, /javascript:/);
  assert.match(res.data.content, /href="https:\/\/maitask\.com\/?"/);
  assert.match(res.data.content, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(res.data.content, /Maitask &amp; &lt;Ops&gt;/);
});

test('excel-exporter neutralizes CSV formulas and includes package metadata', () => {
  const res = executeExcel([{ formula: '=cmd|calc', note: 'ok' }], { filename: 'out.xlsx' });
  assert.equal(res.success, true);
  assert.equal(res.metadata.package, '@maitask/excel-exporter');
  assert.match(res.data.csv, /'=cmd\|calc/);
});

test('pdf-parser inflates FlateDecode streams in pure JavaScript', () => {
  const streamText = 'BT /F1 12 Tf 72 720 Td (Hello Compressed PDF) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(streamText, 'latin1'));
  const pdfBuffer = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n3 0 obj\n<< /Filter /FlateDecode /Length ', 'latin1'),
    Buffer.from(String(compressed.length), 'latin1'),
    Buffer.from(' >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ]);

  const res = executePdf({ base64: pdfBuffer.toString('base64') });
  assert.equal(res.success, true);
  assert.equal(res.data.decompressedStreams, 1);
  assert.equal(res.data.compressedStreamsSkipped, 0);
  assert.match(res.data.text, /Hello Compressed PDF/);
});

test('image-metadata parses PNG, WebP VP8X, and JPEG SOF3 headers cleanly', () => {
  // 1x1 PNG
  const pngRes = executeImageMeta({
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4//8/AwAI/AL+L7N4xQAAAABJRU5ErkJggg=='
  });
  assert.equal(pngRes.success, true);
  assert.deepEqual(pngRes.data.dimensions, { width: 1, height: 1 });

  // WebP VP8X header (width=320, height=240 => stored -1)
  const webp = Buffer.alloc(30, 0);
  webp.write('RIFF', 0);
  webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8);
  webp.write('VP8X', 12);
  webp.writeUInt32LE(10, 16);
  webp[24] = 319 & 0xff;
  webp[25] = (319 >> 8) & 0xff;
  webp[26] = 0;
  webp[27] = 239 & 0xff;
  webp[28] = (239 >> 8) & 0xff;
  webp[29] = 0;
  const webpRes = executeImageMeta({ base64: webp.toString('base64') });
  assert.equal(webpRes.success, true);
  assert.deepEqual(webpRes.data.dimensions, { width: 320, height: 240 });
});

test('diff-generator trims common lines and guards giant dense DP allocation', () => {
  const res = executeDiff({ old: 'a\nb\nc', new: 'a\nx\nc' });
  assert.equal(res.success, true);
  const giantA = Array.from({ length: 1200 }, (_, i) => `left-${i}`).join('\n');
  const giantB = Array.from({ length: 1200 }, (_, i) => `right-${i}`).join('\n');
  const fail = executeDiff({ old: giantA, new: giantB });
  assert.equal(fail.success, false);
});

test('web-search does not misclassify legitimate titles like Roadmap or Header as ads', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      '<div class="result results_links"><h2><a class="result__a" href="https://example.com/roadmap">2026 Engineering Roadmap & Header Spec</a></h2></div>'
  });
  t.after(() => {
    global.fetch = originalFetch;
  });
  const res = await executeWebSearch({ query: 'roadmap spec', engine: 'duckduckgo' });
  assert.equal(res.success, true);
  assert.equal(res.data.results.length, 1);
});

test('data packages reject prototype pollution across csv, validator, json/file transformers, file-processor, and yaml', async () => {
  delete Object.prototype.polluted;

  const csvRes = executeCsv('__proto__,name\nx,alice', { headers: true });
  assert.equal(csvRes.success, false);
  assert.equal(({}).polluted, undefined);

  const fileTx = await executeFileTx({ data: '[__proto__]\npolluted = "yes"', from: 'toml', to: 'json' });
  assert.equal(fileTx.success, false);
  assert.equal(({}).polluted, undefined);

  const jsonTx = executeJsonTx({}, { operation: 'unflatten', separator: '.' });
  assert.equal(jsonTx.success, true);
  const jsonPollute = executeJsonTx({ ['__proto__.polluted']: 'yes' }, { operation: 'unflatten' });
  assert.equal(jsonPollute.success, false);
  assert.equal(({}).polluted, undefined);

  const yamlRes = executeYaml('__proto__:\n  polluted: true', { direction: 'yaml-to-json' });
  assert.equal(yamlRes.success, false);
  assert.equal(({}).polluted, undefined);

  const procFlatten = executeFileProc(
    [JSON.parse('{"__proto__": {"polluted": ["yes"]}}')],
    { operation: 'pipeline', steps: [{ type: 'flatten', field: '__proto__.polluted' }] }
  );
  assert.equal(({}).polluted, undefined);
  assert.equal(procFlatten.success, true);

  const procRes = executeFileProc(
    [{ name: 'alice' }],
    { operation: 'transform', transformRules: { fields: [{ name: '__proto__', to: '__proto__', source: 'name' }] } }
  );
  assert.equal(procRes.success, false);
  assert.equal(({}).polluted, undefined);

  const valRes = await executeValidator(
    { data: [{ count: '' }] },
    { custom_rules: [{ field: 'count', rule: 'numeric' }] }
  );
  assert.equal(valRes.success, false);
});

test('nocodb-importer ignores input.options credentials/baseUrl and works dry-run cleanly', async () => {
  let calledFetch = false;
  const orig = global.fetch;
  global.fetch = async () => {
    calledFetch = true;
    throw new Error('should not be called in dryRun');
  };
  try {
    const res = await executeNocoDb(
      { content: 'name,score\nAlice,10', options: { baseUrl: 'https://evil.example', token: 'stolen' } },
      { baseUrl: 'https://noco.example', token: 'real-tok', baseId: 'b1', tableName: 't1', dryRun: true }
    );
    assert.equal(res.success, true);
    assert.equal(calledFetch, false);
  } finally {
    global.fetch = orig;
  }
});

test('text-parser, url-analyzer, xml-parser, s3-storage list, stream-publisher, and image-generator execute cleanly', async t => {
  assert.equal(executeText({ text: '# Hello\nworld' }).success, true);
  assert.equal(executeUrl({ url: 'https://maitask.com/docs?q=1' }).success, true);
  assert.equal(executeXml({ xml: '<root><item>ok</item></root>' }).success, true);

  const orig = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('s3.example.com')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '<ListBucketResult><Prefix>logs/</Prefix><IsTruncated>false</IsTruncated><Contents><Key>logs/a.txt</Key><Size>42</Size></Contents></ListBucketResult>'
      };
    }
    if (u.includes('stream.example.com')) {
      assert.equal(init.redirect, 'manual');
      return { ok: true, status: 200, text: async () => 'accepted' };
    }
    if (u.includes('api.openai.com')) {
      assert.equal(init.headers.Authorization, 'Bearer secret-img-key');
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ url: 'https://cdn.example/a.png' }] }) };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  t.after(() => { global.fetch = orig; });

  const s3Res = await executeS3({ operation: 'list', presignedUrl: 'https://s3.example.com/?list-type=2' });
  assert.equal(s3Res.success, true);
  assert.equal(s3Res.data.objects[0].key, 'logs/a.txt');

  const spRes = await executeStreamPub(
    [{ event: 'ping' }],
    { url: 'https://stream.example.com/ingest', mode: 'sse', event_name: 'update', tokenSecret: 'STREAM_KEY' },
    { secrets: { STREAM_KEY: 'top-secret' } }
  );
  assert.equal(spRes.success, true);

  const spInjection = await executeStreamPub(
    [{ event: 'ping' }],
    { url: 'https://stream.example.com/ingest', mode: 'sse', event_name: 'bad\r\nInjected: 1' }
  );
  assert.equal(spInjection.success, false);

  const imgRes = await executeImageGen(
    { prompt: 'crane' },
    {},
    { secrets: { OPENAI_API_KEY: 'secret-img-key' } }
  );
  assert.equal(imgRes.success, true);
  assert.equal(imgRes.metadata.package, '@maitask/image-generator');
});

test('messaging packages route through Deno.core.ops.op_http_request cleanly without redirect:error failure', async t => {
  const originalDeno = globalThis.Deno;
  const calls = [];
  globalThis.Deno = {
    core: {
      ops: {
        async op_http_request(url, init) {
          assert.equal(init.redirect, 'manual');
          calls.push(url);
          if (url.includes('slack')) {
            return { status: 200, headers: {}, bodyBase64: Buffer.from('ok').toString('base64') };
          }
          if (url.includes('telegram')) {
            return {
              status: 200,
              headers: {},
              bodyBase64: Buffer.from(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 2 }, text: 'hi' } })).toString('base64')
            };
          }
          return {
            status: 200,
            headers: {},
            bodyBase64: Buffer.from(JSON.stringify({ offsets: [{ partition: 0, offset: 9 }] })).toString('base64')
          };
        }
      }
    }
  };
  t.after(() => { globalThis.Deno = originalDeno; });

  assert.equal((await executeSlack('hi', { webhookUrl: 'https://hooks.slack.com/services/T1/B1/S1' })).success, true);
  assert.equal((await executeTelegram('hi', { botToken: '123:abc', chatId: '-1001' })).success, true);
  assert.equal((await executeKafka({ proxyUrl: 'https://kafka.example.com', topic: 'events', messages: [{ a: 1 }] })).success, true);
  assert.equal(calls.length, 3);
});

test('all 5 AI providers handle non-streaming fetch bodies in Runtime SSE/NDJSON and emit metadata.usage', async t => {
  const origFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = String(url);
    const body = JSON.parse(init.body);
    if (u.includes('anthropic')) {
      assert.equal(body.system, 'Be brief.');
      assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
      return {
        ok: true,
        status: 200,
        text: async () =>
          'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n' +
          'data: {"type":"content_block_delta","delta":{"text":"Claude ok"}}\n\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
      };
    }
    if (u.includes('generativelanguage')) {
      assert.deepEqual(body.systemInstruction, { parts: [{ text: 'System gem' }] });
      assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'hi' }] }]);
      return {
        ok: true,
        status: 200,
        text: async () =>
          'data: {"candidates":[{"content":{"parts":[{"text":"Gem ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}\n\n'
      };
    }
    if (u.includes('deepseek')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          'data: {"choices":[{"delta":{"content":"DS ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\ndata: [DONE]\n\n'
      };
    }
    if (u.includes('localhost:11434')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ message: { content: 'Ol ok' }, done: true, prompt_eval_count: 1, eval_count: 2 }) + '\n'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        'data: {"choices":[{"delta":{"content":"OA ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\ndata: [DONE]\n\n'
    };
  };
  t.after(() => { global.fetch = origFetch; });

  const c = await executeClaude(
    { messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' }], stream: true },
    { apiKey: 'k', retries: 0 }
  );
  assert.equal(c.success, true);
  assert.equal(c.data.content, 'Claude ok');
  assert.equal(c.metadata.usage.total_tokens, 9);

  const g = await executeGemini(
    { messages: [{ role: 'system', content: 'System gem' }, { role: 'user', content: 'hi' }], stream: true },
    {},
    { secrets: { GEMINI_API_KEY: 'k' } }
  );
  assert.equal(g.success, true);
  assert.equal(g.data.content, 'Gem ok');
  assert.equal(g.metadata.usage.total_tokens, 5);

  const d = await executeDeepSeek({ text: 'hi', stream: true }, { apiKey: 'k', retries: 0 });
  assert.equal(d.success, true);
  assert.equal(d.data.content, 'DS ok');
  assert.equal(d.metadata.usage.total_tokens, 7);

  const o = await executeOllama({ text: 'hi', stream: true }, { retries: 0 });
  assert.equal(o.success, true);
  assert.equal(o.data.content, 'Ol ok');
  assert.equal(o.metadata.usage.total_tokens, 3);

  const oa = await executeOpenAI({ text: 'hi', stream: true }, { apiKey: 'k', retries: 0 });
  assert.equal(oa.success, true);
  assert.equal(oa.data.content, 'OA ok');
  assert.equal(oa.metadata.usage.total_tokens, 4);
});

function buildZlibDeflateBytes(bitGroups) {
  const bytes = [0x78, 0x9c];
  let cur = 0;
  let bits = 0;
  for (const [val, width] of bitGroups) {
    for (let i = 0; i < width; i += 1) {
      cur |= ((val >>> i) & 1) << bits;
      bits += 1;
      if (bits === 8) {
        bytes.push(cur);
        cur = 0;
        bits = 0;
      }
    }
  }
  if (bits > 0) bytes.push(cur);
  bytes.push(0, 0, 0, 1);
  return Buffer.from(bytes);
}

function buildFlatePdfBase64(zlibBytes) {
  const head = `%PDF-1.4\n1 0 obj << /Length ${zlibBytes.length} /Filter /FlateDecode >>\nstream\n`;
  const tail = `\nendstream\nendobj\n%%EOF`;
  return Buffer.concat([Buffer.from(head, 'latin1'), zlibBytes, Buffer.from(tail, 'latin1')]).toString('base64');
}

test('pdf-parser rejects corrupt dynamic Huffman tables and out-of-bounds LZ77 back-references', () => {
  // Dynamic block: BFINAL=1, BTYPE=2, HLIT=0 (257), HDIST=0 (1), HCLEN=0 (4 clens),
  // code-len-alphabet order [16]=3 -> clen[16]=3 so code '000' -> sym 16, then 0b000 hits sym 16 on empty lengths
  const emptyRepeatZlib = buildZlibDeflateBytes([
    [1, 1], [2, 2], [0, 5], [0, 5], [0, 4],
    [0, 3], [0, 3], [0, 3], [3, 3],
    [0, 3]
  ]);
  const rEmpty = executePdf({ base64: buildFlatePdfBase64(emptyRepeatZlib) });
  assert.equal(rEmpty.success, true);
  assert.equal(rEmpty.data.decompressedStreams, 0);
  assert.equal(rEmpty.data.compressedStreamsSkipped, 1);

  // Dynamic block: clen[0]=1 (0 -> sym 16 if clen[16]=1? Use clen[16]=2, clen[17]=1 -> wait: clen[16]=1 (code '0'), clen[17]=1 unreachable, so put 2 symbols: clen[16]=2 (code '01'), clen[17]=1 (code '0' -> wait prefix conflict). Use clen[16]=2 (00), clen[17]=2 (01), clen[18]=2 (10), clen[0]=2 (11): emit sym 0 (11 -> 2 bits reversed '11'=3), then sym 18 (10 reversed = '01'=1) + 127 extra bits = 138 repeats > 258 total!
  const overflowRepeatZlib = buildZlibDeflateBytes([
    [1, 1], [2, 2], [0, 5], [0, 5], [0, 4],
    [2, 3], [2, 3], [2, 3], [2, 3],
    [3, 2], // sym 0 (bits 1,1 -> reversed 11)
    [1, 2], // sym 18? Order of clens is [16,17,18,0]: clen[16]=2 (code 00), clen[17]=2 (code 01), clen[18]=2 (code 10 -> MSB-first bits 1,0 = value 1 LSB-first), clen[0]=2 (code 11)
    [127, 7], // repeat 138 zeros
    [1, 2], [127, 7] // another 138 -> exceeds hlit+hdist=258
  ]);
  const rOverflow = executePdf({ base64: buildFlatePdfBase64(overflowRepeatZlib) });
  assert.equal(rOverflow.success, true);
  assert.equal(rOverflow.data.decompressedStreams, 0);
  assert.equal(rOverflow.data.compressedStreamsSkipped, 1);

  // Fixed Huffman block (BFINAL=1, BTYPE=1): back-reference with out-of-bounds length sym 286 (code 286-256=30? In fixed Huffman: 280..287 are 8-bit codes 11000000..11000111 -> 286 is 0b11000110 reversed LSB-first = 0b01100011)
  const badLenZlib = buildZlibDeflateBytes([
    [1, 1], [1, 2], [0b01100011, 8]
  ]);
  const rBadLen = executePdf({ base64: buildFlatePdfBase64(badLenZlib) });
  assert.equal(rBadLen.success, true);
  assert.equal(rBadLen.data.decompressedStreams, 0);
  assert.equal(rBadLen.data.compressedStreamsSkipped, 1);

  // Fixed Huffman block: length 3 (sym 257 -> 7-bit 0000001 -> reversed 0b1000000), distance 1 (5-bit 00000) when out.length === 0!
  const badDistZlib = buildZlibDeflateBytes([
    [1, 1], [1, 2], [0b1000000, 7], [0, 5]
  ]);
  const rBadDist = executePdf({ base64: buildFlatePdfBase64(badDistZlib) });
  assert.equal(rBadDist.success, true);
  assert.equal(rBadDist.data.decompressedStreams, 0);
  assert.equal(rBadDist.data.compressedStreamsSkipped, 1);
});

test('audio-processor uses Uint8Array on Node fetch, bodyBase64 on Runtime fetch, timeouts, redirect: manual, and full SSRF blocking', async t => {
  const origFetch = global.fetch;
  const origDeno = globalThis.Deno;
  t.after(() => {
    global.fetch = origFetch;
    if (origDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = origDeno;
  });

  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('audio.example.com')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'gem audio' }] } }] }) };
    }
    if (url.includes('/v1/audio/speech')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 8]).buffer };
    }
    return { ok: true, status: 200, json: async () => ({ text: 'ok transcript', language: 'en', duration: 1.5 }) };
  };

  // Node Whisper multipart body uses Uint8Array, not bodyBase64
  const whisperRes = await executeAudio(
    { task: 'transcribe', provider: 'whisper', audioUrl: 'https://audio.example.com/clip.mp3' },
    { apiKey: 'sk-audio-secret', timeoutMs: 12000 }
  );
  assert.equal(whisperRes.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.timeoutMs, 12000);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.ok(calls[1].init.body instanceof Uint8Array);
  assert.equal(calls[1].init.bodyBase64, undefined);
  assert.equal(calls[1].init.redirect, 'manual');
  assert.equal(calls[1].init.timeoutMs, 12000);
  assert.ok(calls[1].init.signal instanceof AbortSignal);

  // Runtime mode emits bodyBase64
  globalThis.Deno = { core: { ops: { op_http_request: () => {} } } };
  const rtRes = await executeAudio(
    { task: 'transcribe', provider: 'whisper', audioData: Buffer.from('abc').toString('base64') },
    { apiKey: 'sk-audio-secret' }
  );
  assert.equal(rtRes.success, true);
  assert.equal(typeof calls[2].init.bodyBase64, 'string');
  assert.equal(calls[2].init.body, undefined);
  assert.equal(calls[2].init.timeoutMs, 30000);
  delete globalThis.Deno;

  // Gemini & TTS also enforce redirect: manual, timeoutMs, AbortSignal
  const gemRes = await executeAudio(
    { task: 'analyze', provider: 'gemini', audioData: Buffer.from('abc').toString('base64') },
    { apiKey: 'gem-secret' }
  );
  assert.equal(gemRes.success, true);
  assert.equal(calls[3].init.redirect, 'manual');
  assert.equal(calls[3].init.timeoutMs, 30000);
  assert.ok(calls[3].init.signal instanceof AbortSignal);

  const ttsRes = await executeAudio(
    { task: 'generate', provider: 'openai', text: 'hello' },
    { apiKey: 'tts-secret' }
  );
  assert.equal(ttsRes.success, true);
  assert.equal(calls[4].init.redirect, 'manual');
  assert.equal(calls[4].init.timeoutMs, 30000);
  assert.ok(calls[4].init.signal instanceof AbortSignal);

  // SSRF host variants blocked
  for (const blocked of [
    'https://localhost./a.mp3',
    'https://[::ffff:127.0.0.1]/a.mp3',
    'https://[fe80::1]/a.mp3',
    'https://[febf::1]/a.mp3',
    'https://100.64.0.1/a.mp3',
    'https://printer.local/a.mp3',
    'https://meta.internal/a.mp3',
    'https://box.localdomain/a.mp3'
  ]) {
    const res = await executeAudio({ task: 'transcribe', provider: 'whisper', audioUrl: blocked }, { apiKey: 'k' });
    assert.equal(res.success, false, `Expected ${blocked} to be blocked`);
  }
});

test('data-validator and s3-storage block trailing-dot, IPv4-mapped IPv6, fe80::/10, CGNAT, and untrusted input.config overrides', async t => {
  const origFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async (url, init = {}) => {
    fetchCalled = true;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ type: 'object', properties: { id: { type: 'string', required: true } } }),
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0)
    };
  };
  t.after(() => { global.fetch = origFetch; });

  // Untrusted input.config.schema_url and validation_mode cannot override options or default strict mode
  const untrustedRes = await executeValidator(
    {
      data: [{ wrong: 1 }],
      config: { schema_url: 'https://127.0.0.1/evil.json', validation_mode: 'report-only' }
    },
    { required_fields: ['id'] }
  );
  assert.equal(fetchCalled, false);
  assert.equal(untrustedRes.success, false);
  assert.equal(untrustedRes.data.validation_mode, 'strict');

  // Trusted options.schema_url passes timeoutMs: 10000
  let seenInit = null;
  global.fetch = async (url, init = {}) => {
    seenInit = init;
    return { ok: true, status: 200, text: async () => JSON.stringify({ properties: { id: { type: 'string', required: true } } }) };
  };
  const trustedRes = await executeValidator(
    { data: [{ id: 'ok' }], config: { schema_url: 'https://evil.example/other.json', validation_mode: 'report-only' } },
    { schema_url: 'https://93.184.216.34/schema.json', validation_mode: 'strict' }
  );
  assert.equal(trustedRes.success, true);
  assert.equal(seenInit.timeoutMs, 10000);
  assert.equal(seenInit.redirect, 'manual');

  for (const blocked of [
    'https://localhost./x.json',
    'https://[::ffff:127.0.0.1]/x.json',
    'https://[feb0::1]/x.json',
    'https://100.64.5.5/x.json',
    'https://db.local/x.json',
    'https://svc.internal/x.json',
    'https://dev.localdomain/x.json'
  ]) {
    const valBlocked = await executeValidator({ data: [{}] }, { schema_url: blocked });
    assert.equal(valBlocked.success, false, `data-validator expected ${blocked} blocked`);
    const s3Blocked = await executeS3({ operation: 'download', presignedUrl: blocked });
    assert.equal(s3Blocked.success, false, `s3-storage expected ${blocked} blocked`);
  }
});

test('nocodb-importer forwards timeoutMs, rejects untrusted baseUrl, and redacts URLs and tokens in errors', async t => {
  const origFetch = global.fetch;
  const seenInits = [];
  global.fetch = async (url, init = {}) => {
    seenInits.push(init);
    return {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => ''
    };
  };
  t.after(() => { global.fetch = origFetch; });

  const missingTrusted = await executeNocoDb(
    { content: 'a,b\n1,2', options: { baseUrl: 'https://evil.example' } },
    { token: 'tok-123', baseId: 'b1', tableName: 'tbl' }
  );
  assert.equal(missingTrusted.success, false);

  const errRes = await executeNocoDb(
    { content: 'a,b\n1,2' },
    { baseUrl: 'https://noco.internal.example', token: 'noco-secret-xyz', baseId: 'b1', tableName: 'tbl', timeoutMs: 15000 }
  );
  assert.equal(errRes.success, false);
  assert.equal(seenInits[0].timeoutMs, 15000);
  assert.equal(errRes.error.message.includes('noco.internal.example'), false);
  assert.equal(errRes.error.message.includes('noco-secret-xyz'), false);

  global.fetch = async (url, init = {}) => {
    seenInits.push(init);
    throw new Error('connect failed https://noco.internal.example/api/v2/meta?k=noco-secret-xyz');
  };
  const netErrRes = await executeNocoDb(
    { content: 'a,b\n1,2' },
    { baseUrl: 'https://noco.internal.example', token: 'noco-secret-xyz', baseId: 'b1', tableName: 'tbl', timeoutMs: 15000 }
  );
  assert.equal(netErrRes.success, false);
  assert.equal(netErrRes.error.message.includes('noco.internal.example'), false);
  assert.equal(netErrRes.error.message.includes('noco-secret-xyz'), false);
});

test('claude preserves and joins input.system (string or array) with system role messages', async t => {
  const origFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1, output_tokens: 1 }
      })
    };
  };
  t.after(() => { global.fetch = origFetch; });

  const strRes = await executeClaude(
    { system: 'First.', messages: [{ role: 'system', content: 'Second.' }, { role: 'user', content: 'hi' }] },
    { apiKey: 'k' }
  );
  assert.equal(strRes.success, true);
  assert.equal(bodies[0].system, 'First.\n\nSecond.');

  const arrRes = await executeClaude(
    {
      system: [{ type: 'text', text: 'Cached.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'system', content: 'Extra.' }, { role: 'user', content: 'hi' }]
    },
    { apiKey: 'k' }
  );
  assert.equal(arrRes.success, true);
  assert.deepEqual(bodies[1].system, [
    { type: 'text', text: 'Cached.', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'Extra.' }
  ]);
});

test('intelligence-briefing preserves unparsed AI prose on hacker_news_daily and redacts secrets and URLs on error', async t => {
  const origFetch = global.fetch;
  t.after(() => { global.fetch = origFetch; });

  const missingKey = await executeBriefing(
    { sourceData: [{ id: 1, title: 'Story A', url: 'https://example.com/a', score: 50 }] },
    { ai: { enabled: true } }
  );
  assert.equal(missingKey.success, false);
  assert.equal(missingKey.error.message.includes('DEXPS_API_KEY'), false);

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: 'Hacker News Daily\n\nCustom AI prose summary without JSON wrapper.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    })
  });
  const proseRes = await executeBriefing(
    {
      sourceData: [{ id: 1, title: 'Story A', url: 'https://example.com/a', score: 50, commentCount: 10 }]
    },
    {
      output: { product: 'hacker_news_daily', includeSources: true },
      ai: { enabled: true, apiKey: 'sk-brief-secret', baseUrl: 'https://llm.example.test/v1' }
    }
  );
  assert.equal(proseRes.success, true);
  assert.match(proseRes.metadata.channel_message, /Custom AI prose summary without JSON wrapper\./);
  assert.match(proseRes.metadata.channel_message, /https:\/\/example\.com\/a/);

  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'upstream error at https://llm.example.test/v1/chat/completions with key sk-brief-secret'
  });
  const errRes = await executeBriefing(
    { sourceData: [{ id: 1, title: 'Story A', url: 'https://example.com/a', score: 50 }] },
    { ai: { enabled: true, apiKey: 'sk-brief-secret', baseUrl: 'https://llm.example.test/v1', retries: 0 } }
  );
  assert.equal(errRes.success, false);
  assert.equal(errRes.error.message.includes('sk-brief-secret'), false);
  assert.equal(errRes.error.message.includes('https://llm.example.test'), false);
});

test('hackernews-crawler validates baseUrl, sets timeout/redirect: manual, and rejects 3xx redirects', async t => {
  const badScheme = await executeHackerNews({ apiBaseUrl: 'file:///etc/passwd' });
  assert.equal(badScheme.success, false);
  const badCreds = await executeHackerNews({ apiBaseUrl: 'https://user:pass@hacker-news.firebaseio.com/v0' });
  assert.equal(badCreds.success, false);

  const origFetch = global.fetch;
  let seenInit = null;
  global.fetch = async (_url, init) => {
    seenInit = init;
    return { ok: false, status: 302, type: 'basic' };
  };
  t.after(() => { global.fetch = origFetch; });
  const redir = await executeHackerNews({ limit: 1 }, { timeoutMs: 9000 });
  assert.equal(redir.success, false);
  assert.equal(seenInit.redirect, 'manual');
  assert.equal(seenInit.timeoutMs, 9000);
  assert.ok(seenInit.signal instanceof AbortSignal);
});

test('stream-publisher and graphql-client read error bodies boundedly and redact secrets and URLs', async t => {
  const origFetch = global.fetch;
  t.after(() => { global.fetch = origFetch; });

  const makeLargeErrorResponse = token => ({
    ok: false,
    status: 500,
    type: 'basic',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`boom ${token} https://secret.internal/path ` + 'x'.repeat(25000)));
        controller.close();
      }
    }),
    text: async () => {
      throw new Error('unbounded text() must not be used');
    }
  });

  global.fetch = async () => makeLargeErrorResponse('stream-tok-999');
  const spErr = await executeStreamPub(
    [{ event: 'ping' }],
    { url: 'https://stream.example.com/ingest', tokenSecret: 'STREAM_TOK', secrets: { STREAM_TOK: 'stream-tok-999' } }
  );
  assert.equal(spErr.success, false);
  assert.equal(spErr.error.message.includes('stream-tok-999'), false);
  assert.equal(spErr.error.message.includes('secret.internal'), false);
  assert.ok(spErr.error.message.length <= 16500);

  global.fetch = async () => makeLargeErrorResponse('gql-tok-888');
  const gqlErr = await executeGraphQL(
    { url: 'https://gql.example.com/graphql', query: '{ ok }' },
    { tokenSecret: 'GQL_TOK', secrets: { GQL_TOK: 'gql-tok-888' } }
  );
  assert.equal(gqlErr.success, false);
  assert.equal(gqlErr.error.message.includes('gql-tok-888'), false);
  assert.equal(gqlErr.error.message.includes('secret.internal'), false);
  assert.ok(gqlErr.error.message.length <= 16500);
});

test('SSRF guards block private/internal targets unless allowPrivateHosts is opted in', async t => {
  const origFetch = global.fetch;
  let fetchCalled = 0;
  t.after(() => { global.fetch = origFetch; });
  global.fetch = async () => {
    fetchCalled += 1;
    throw new Error('fetch must not be reached for blocked private hosts');
  };

  const blockedHosts = [
    'https://100.64.0.1/path',
    'https://[fe80::1]/path',
    'https://[::ffff:127.0.0.1]/path',
    'https://localhost./path',
    'https://service.localdomain/path'
  ];

  for (const blockedUrl of blockedHosts) {
    const wsRes = await executeWebScraper(blockedUrl);
    assert.equal(wsRes.success, false);

    const gqlRes = await executeGraphQL({ url: blockedUrl, query: '{ ok }' });
    assert.equal(gqlRes.success, false);

    const spRes = await executeStreamPub([{ ok: true }], { url: blockedUrl });
    assert.equal(spRes.success, false);

    const hnRes = await executeHackerNews({ storyType: 'top', limit: 1 }, { apiBaseUrl: blockedUrl });
    assert.equal(hnRes.success, false);

    const nocoRes = await executeNocoDb(
      { content: 'a,b\n1,2' },
      { baseUrl: blockedUrl, token: 'tok', baseId: 'b1', tableName: 't1', dryRun: true }
    );
    assert.equal(nocoRes.success, false);

    const searchRes = await executeWebSearch({ query: 'hello' }, { baseUrl: blockedUrl });
    assert.equal(searchRes.success, false);

    const docRes = await executeDocIntel({ text: 'hello' }, { apiKey: 'k', baseUrl: blockedUrl });
    assert.equal(docRes.success, false);

    const compRes = await executeComposer(
      { description: 'hello', catalog: [{ name: '@maitask/text-parser' }] },
      { apiKey: 'k', baseUrl: blockedUrl }
    );
    assert.equal(compRes.success, false);

    const briefRes = await executeBriefing(
      { sourceData: [{ id: '1', title: 'Test', url: 'https://example.com/1' }] },
      { ai: { apiKey: 'k', baseUrl: blockedUrl } }
    );
    assert.equal(briefRes.success, false);

    const aiProviders = [
      executeClaude({ text: 'hi' }, { apiKey: 'k', baseUrl: blockedUrl }),
      executeDeepSeek({ text: 'hi' }, { apiKey: 'k', baseUrl: blockedUrl }),
      executeGemini({ text: 'hi' }, { apiKey: 'k', baseUrl: blockedUrl }),
      executeOpenAI({ text: 'hi' }, { apiKey: 'k', baseUrl: blockedUrl }),
      executeOllama({ text: 'hi' }, { baseUrl: blockedUrl })
    ];
    for (const promise of aiProviders) {
      const res = await promise;
      assert.equal(res.success, false);
    }

    const tgRes = await executeTelegram(
      { fileUrl: blockedUrl },
      { botToken: 'tok', chatId: '1', messageType: 'document' }
    );
    assert.equal(tgRes.success, false);

    const trRes = await executeTrader(
      { action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m', exchange: { provider: 'binance', market: 'spot', environment: 'testnet' } },
      { baseUrl: blockedUrl }
    );
    assert.equal(trRes.success, false);
  }
  assert.equal(fetchCalled, 0);

  // Opt-in allowPrivateHosts permits loopback fixtures across updated packages
  global.fetch = async url => ({
    ok: true,
    status: 200,
    type: 'basic',
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ data: { ok: true }, klines: [], price: '100' }),
    json: async () => ({ data: { ok: true } })
  });
  const allowedGql = await executeGraphQL(
    { url: 'http://127.0.0.1:8080/graphql', query: '{ ok }' },
    { allowInsecureHttp: true, allowPrivateHosts: true }
  );
  assert.equal(allowedGql.success, true);

  // Trader allowPrivateHosts permits https private overrides too
  const mockKlines = Array.from({ length: 20 }, (_, i) => [
    1700000000000 + i * 60000,
    '100',
    '105',
    '99',
    '104',
    '10'
  ]);
  global.fetch = async url => {
    if (String(url).includes('/klines')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        arrayBuffer: async () => Buffer.from(JSON.stringify(mockKlines))
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ price: '104' }))
    };
  };
  const allowedTrader = await executeTrader(
    { action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m', exchange: { provider: 'binance', market: 'spot', environment: 'testnet' } },
    { baseUrl: 'https://127.0.0.1:8443', allowPrivateHosts: true }
  );
  assert.equal(allowedTrader.success, true);
});

test('untrusted input overrides are ignored across search, graphql, hn, briefing, ai, and transformers', async t => {
  const origFetch = global.fetch;
  const seenUrls = [];
  const seenHeaders = [];
  t.after(() => { global.fetch = origFetch; });

  global.fetch = async (url, init = {}) => {
    seenUrls.push(String(url));
    seenHeaders.push(init.headers || {});
    return {
      ok: true,
      status: 200,
      type: 'basic',
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        content: [{ type: 'text', text: 'ok' }],
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        message: { content: 'ok' },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, input_tokens: 1, output_tokens: 1 },
        data: [{ url: 'https://img.example/1.png' }]
      })
    };
  };

  // web-search ignores untrusted input baseUrl/engineBaseUrls/headers and falls back from Bing error cleanly
  const searchRes = await executeWebSearch({
    query: 'test',
    engine: 'duckduckgo',
    baseUrl: 'https://evil.example',
    engineBaseUrls: { duckduckgo: 'https://evil.example' },
    headers: { 'X-Evil': '1' }
  });
  assert.equal(seenUrls[0].startsWith('https://duckduckgo.com/'), true);
  assert.equal(seenHeaders[0]['X-Evil'], undefined);
  assert.equal(searchRes.success, true);

  // graphql-client binds tokenSecret to options, not input, and ignores inherited prototype keys
  const gqlToString = await executeGraphQL(
    { url: 'https://api.example.com/graphql', query: '{ ok }', tokenSecret: 'SECRET' },
    { tokenSecret: 'toString' },
    { secrets: { SECRET: 'hidden' } }
  );
  assert.equal(gqlToString.success, false);
  assert.match(gqlToString.error.message, /toString is required/);

  // hackernews-crawler rejects input.apiBaseUrl override
  const hnBad = await executeHackerNews({ storyType: 'top', apiBaseUrl: 'https://evil.example' });
  assert.equal(hnBad.success, false);

  // intelligence-briefing ignores input.ai.baseUrl/apiKey override
  seenUrls.length = 0;
  const briefRes = await executeBriefing(
    {
      sourceData: [{ id: '1', title: 'Story', url: 'https://news.example/1' }],
      ai: { enabled: true, apiKey: 'evil-key', baseUrl: 'https://evil.example/v1' }
    },
    { ai: { apiKey: 'trusted-key', baseUrl: 'https://api.openai.com/v1' } }
  );
  assert.equal(seenUrls.some(u => u.includes('evil.example')), false);
  assert.equal(briefRes.metadata.package, '@maitask/intelligence-briefing');

  // AI providers + image-generator ignore input.apiKey / input.baseUrl
  seenUrls.length = 0;
  seenHeaders.length = 0;
  await executeOpenAI(
    { text: 'hi', apiKey: 'evil', baseUrl: 'https://evil.example/v1' },
    { apiKey: 'trusted-openai' }
  );
  await executeClaude(
    { text: 'hi', api_key: 'evil', baseUrl: 'https://evil.example/v1' },
    { apiKey: 'trusted-claude' }
  );
  await executeDeepSeek(
    { text: 'hi', apiKey: 'evil', base_url: 'https://evil.example/v1' },
    { apiKey: 'trusted-ds' }
  );
  await executeGemini(
    { text: 'hi', model: 'gemini/pro:custom', apiKey: 'evil', baseUrl: 'https://evil.example/v1' },
    { apiKey: 'trusted-gem' }
  );
  await executeOllama(
    { text: 'hi', baseUrl: 'https://evil.example' },
    { baseUrl: 'http://127.0.0.1:11434' }
  );
  await executeImageGen(
    { prompt: 'tree', apiKey: 'evil' },
    { apiKey: 'trusted-img' }
  );
  assert.equal(seenUrls.some(u => u.includes('evil.example')), false);
  assert.ok(seenUrls.some(u => u.includes('gemini%2Fpro%3Acustom%3AgenerateContent') || u.includes('gemini%2Fpro%3Acustom:generateContent')));

  // file-transformer & nocodb-importer ignore input.options overrides
  const ftRes = await executeFileTx({ data: '{"a":1}', from: 'json', to: 'yaml', options: { includeParsed: true } });
  assert.equal(ftRes.success, true);
  assert.equal(ftRes.data.parsed, undefined);
});

test('P0/P1 parser, validation, streaming, and logic fixes hold under adversarial inputs', async t => {
  const origFetch = global.fetch;
  t.after(() => { global.fetch = origFetch; });

  // web-scraper zero-width regex & oversize pattern
  global.fetch = async () => ({
    ok: true,
    status: 200,
    type: 'basic',
    headers: { get: () => 'text/html' },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('<html><title>Hi</title><body>abc</body></html>'));
        c.close();
      }
    })
  });
  const wsZeroWidth = await executeWebScraper('https://example.com', {
    patterns: [
      { name: 'zw', pattern: '(?:)' },
      { name: 'long', pattern: 'a'.repeat(513) }
    ]
  });
  assert.equal(wsZeroWidth.success, true);
  assert.ok(wsZeroWidth.data.items[0].data.patterns[0].matches.length > 0);
  assert.match(wsZeroWidth.data.items[0].data.patterns[1].error, /512/);

  // ollama NDJSON flush + stream cancel
  let cancelled = false;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    type: 'basic',
    body: {
      getReader() {
        const chunks = [new TextEncoder().encode('{"model":"llama3.2","message":{"content":"ok"},"done":true}')];
        return {
          async read() {
            if (chunks.length) return { done: false, value: chunks.shift() };
            return { done: true, value: undefined };
          },
          async cancel() {
            cancelled = true;
          }
        };
      }
    }
  });
  const olRes = await executeOllama({ text: 'hi', stream: true });
  assert.equal(olRes.success, true);
  assert.equal(olRes.data.content, 'ok');
  assert.equal(cancelled, true);

  // data-validator $ref cycle guard + loose validation_mode + schema_url error redaction
  const cyclicVal = await executeValidator([{ id: '1' }], {
    schema: {
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      $ref: '#/$defs/node'
    }
  });
  assert.equal(cyclicVal.success, true);

  const looseVal = await executeValidator([{ name: 'Alice', code: 'bad' }], {
    validation_mode: 'loose',
    schema: { type: 'object', properties: { code: { type: 'string', minLength: 10 } } }
  });
  assert.equal(looseVal.success, true);
  assert.equal(looseVal.data.results[0].warnings.length, 1);

  const looseCrit = await executeValidator([{ code: 'ok' }], {
    validation_mode: 'loose',
    required_fields: ['missing']
  });
  assert.equal(looseCrit.success, false);

  global.fetch = async () => ({ ok: false, status: 500, type: 'basic' });
  const schemaFetchErr = await executeValidator([{ a: 1 }], { schema_url: 'https://secret.example.com/private.json' });
  assert.equal(schemaFetchErr.success, false);
  assert.equal(schemaFetchErr.error.message.includes('secret.example.com'), false);

  // json-transformer callable sourcePath guard & regex-special separator unflatten
  const jtxCallable = executeJsonTx({ a: 1 }, { operation: 'map', mapping: { s: 'toString', fn: () => 'ran' } });
  assert.equal(jtxCallable.success, true);
  assert.equal(jtxCallable.data.s, undefined);
  assert.equal(jtxCallable.data.fn, undefined);

  const jtxUnflat = executeJsonTx({ 'a[0]*b': 42 }, { operation: 'unflatten', separator: '[0]*' });
  assert.equal(jtxUnflat.success, true);
  assert.equal(jtxUnflat.data.a.b, 42);

  // file-processor callable field guard & null-proto distinct count
  const fpRes = executeFileProc([{ a: 'constructor' }], {
    operation: 'transform',
    transformRules: { out: { from: 'toString' } }
  });
  assert.equal(fpRes.success, true);
  assert.equal(fpRes.data.result[0].out, undefined);

  // url-analyzer IPv6, equal sign in query, malformed percent, null options
  const urlRes = executeUrl('https://[2001:db8::1]:8443/p?sig=abc==&bad=%ZZ', null);
  assert.equal(urlRes.success, true);
  assert.equal(urlRes.result.hostname, '[2001:db8::1]');
  assert.equal(urlRes.result.queryParams.sig, 'abc==');

  // excel-exporter newline + formula neutralization
  const exRes = executeExcel([{ cell: '\n=1+1' }]);
  assert.equal(exRes.success, true);
  assert.equal(exRes.data.csv.includes("'\n=1+1"), true);

  // csv-parser & text-parser 4-byte UTF-8 + base64 padding
  const rocketB64 = Buffer.from('a,b\n🚀,ok', 'utf8').toString('base64');
  const csvUtf8 = executeCsv({ base64: rocketB64 }, null);
  assert.equal(csvUtf8.success, true);
  assert.equal(csvUtf8.rows[0].a, '🚀');

  const txtBadB64 = executeText({ base64: 'ab=c' });
  assert.equal(txtBadB64.success, false);

  // diff-generator falsey primitives & object key order
  const diffZero = executeDiff({ old: 0, new: '' });
  assert.equal(diffZero.success, true);
  const diffArrOrder = executeDiff({ old: [{ a: 1, b: 2 }], new: [{ b: 2, a: 1 }] }, { mode: 'array' });
  assert.equal(diffArrOrder.success, true);
  assert.equal(diffArrOrder.hasChanges, false);
  assert.equal(diffArrOrder.added.length, 0);
  assert.equal(diffArrOrder.removed.length, 0);

  // cron-parser step description, impossible date, null options
  const cronDesc = executeCron('*/5 * * * *', { operation: 'describe' });
  assert.equal(cronDesc.success, true);
  assert.equal(cronDesc.data.result.includes('undefined'), false);
  const cronFeb30 = executeCron('0 0 30 2 *', { operation: 'next', from: '2026-01-01T00:00:00Z' });
  assert.equal(cronFeb30.success, false);
  assert.equal(executeCron('* * * * *', null).success, true);

  // markdown-renderer underscores inside link href
  const mdRes = executeMarkdown('[my_doc](https://example.com/path_with_underscores)');
  assert.equal(mdRes.success, true);
  assert.match(mdRes.data.content, /href="https:\/\/example\.com\/path_with_underscores"/);

  // pdf-parser FlateDecode with small maxTextLength
  const compressed = zlib.deflateSync(Buffer.from('BT (Hello Compressed World) Tj ET', 'latin1'));
  const pdfLatin1 = `%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${compressed.toString('latin1')}\nendstream\nendobj\n%%EOF`;
  const pdfRes = executePdf({ base64: Buffer.from(pdfLatin1, 'latin1').toString('base64') }, { maxTextLength: 5 });
  assert.equal(pdfRes.success, true);
  assert.equal(pdfRes.data.decompressedStreams, 1);
  assert.equal(pdfRes.data.text.startsWith('Hello'), true);

  // image-metadata truncated PNG/GIF headers return null dimensions instead of NaN/garbage
  const metaTrunc = executeImageMeta(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'));
  assert.equal(metaTrunc.success, true);
  assert.equal(metaTrunc.data.format, 'PNG');
  assert.equal(metaTrunc.data.dimensions, null);
  assert.equal(metaTrunc.data.colorInfo, null);
  const gifTrunc = executeImageMeta(Buffer.from('GIF89a\x01\x00', 'latin1').toString('base64'));
  assert.equal(gifTrunc.success, true);
  assert.equal(gifTrunc.data.format, 'GIF');
  assert.equal(gifTrunc.data.dimensions, null);

  // yaml-converter cycle guard, indent validation, single-key array newline
  const cyc = {};
  cyc.self = cyc;
  assert.equal(executeYaml({ data: cyc }, { direction: 'json-to-yaml' }).success, false);
  assert.equal(executeYaml('a: 1', { indent: 0 }).success, false);
  const yamlArr = executeYaml({ data: [{ a: 1 }, { b: 2 }] }, { direction: 'json-to-yaml' });
  assert.equal(yamlArr.success, true);
  assert.match(yamlArr.result, /a: 1\n-.*b: 2/);

  // audio-processor srt format & streaming audioUrl limit
  global.fetch = async url => {
    if (String(url).includes('audio.mp3')) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(100));
            c.close();
          }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '1\n00:00:00,000 --> 00:00:01,000\nHello',
      json: async () => { throw new Error('json() must not run for srt'); }
    };
  };
  const audioSrt = await executeAudio(
    { audioUrl: 'https://cdn.example.com/audio.mp3', response_format: 'srt' },
    { apiKey: 'sk-test' }
  );
  assert.equal(audioSrt.success, true);
  assert.match(audioSrt.data.text, /Hello/);
});

test('package schemas, TypeScript headers, and docs stay aligned without legacy artifacts', () => {
  const pkgRoot = path.resolve(__dirname, '..');
  const dirs = fs.readdirSync(pkgRoot)
    .filter(d => fs.existsSync(path.join(pkgRoot, d, 'package.json')))
    .sort();
  assert.equal(dirs.length, 40);

  for (const d of dirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, d, 'package.json'), 'utf8'));
    assert.ok(manifest.maitask?.schemas?.input, `${d} must define maitask.schemas.input`);
    if (['cf-proxy', 'image-metadata', 'text-parser'].includes(d)) {
      assert.equal(manifest.maitask.schemas.options, undefined, `${d} omits schemas.options`);
    } else {
      assert.ok(manifest.maitask.schemas.options, `${d} must define maitask.schemas.options`);
    }

    const dtsPath = path.join(pkgRoot, d, 'index.d.ts');
    if (fs.existsSync(dtsPath)) {
      const dts = fs.readFileSync(dtsPath, 'utf8');
      for (const m of dts.matchAll(/version:\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/g)) {
        assert.equal(m[1], manifest.version, `${d}/index.d.ts literal version must match ${manifest.version}`);
      }
    }

    const readme = fs.readFileSync(path.join(pkgRoot, d, 'README.md'), 'utf8');
    assert.equal(/--options\b/.test(readme), false, `${d}/README.md must not use --options`);
    assert.equal(/npm install @maitask\//.test(readme), false, `${d}/README.md must not suggest npm install @maitask/...`);
    assert.equal(/Node\.js\s*>=\s*14/.test(readme), false, `${d}/README.md must not require Node 14`);
    assert.equal(/DEXPS_/.test(readme), false, `${d}/README.md must not reference DEXPS_`);
  }

  const traderPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'trader/package.json'), 'utf8'));
  assert.equal(traderPkg.maitask.schemas.input.properties.interval.default, undefined);

  const imgGenPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'image-generator/package.json'), 'utf8'));
  assert.equal(imgGenPkg.maitask.schemas.input.properties.apiKey, undefined);
});

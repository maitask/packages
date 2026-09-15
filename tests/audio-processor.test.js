const assert = require('node:assert/strict');
const test = require('node:test');

const { execute } = require('../audio-processor');

test('speech generation does not require source audio', async () => {
  const result = await execute({ task: 'generate', text: 'Hello from Maitask' }, {});
  assert.equal(result.success, false);
  assert.match(result.error.message, /API key is required/);
});

test('speech generation requires text', async () => {
  const result = await execute({ task: 'generate', provider: 'openai' }, { apiKey: 'sk-test' });
  assert.equal(result.success, false);
  assert.match(result.error.message, /Text is required for audio generation/);
});

test('transcription requires source audio', async () => {
  const result = await execute({ task: 'transcribe' }, { apiKey: 'sk-test' });
  assert.equal(result.success, false);
  assert.match(result.error.message, /audioUrl or audioData is required/);
});

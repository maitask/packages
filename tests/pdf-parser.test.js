const assert = require('node:assert/strict');
const test = require('node:test');

const { execute } = require('../pdf-parser');

const SAMPLE_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 55 >>
stream
BT
72 120 Td
(Hello Maitask) Tj
ET
endstream
endobj
5 0 obj
<< /Title (Sample Document) /Author (Maitask) >>
endobj
trailer
<< /Root 1 0 R /Info 5 0 R /Size 6 >>
%%EOF
`;

const ENCRYPTED_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
trailer
<< /Root 1 0 R /Encrypt 3 0 R >>
%%EOF
`;

test('extracts uncompressed text and Info metadata', () => {
  const result = execute({ text: SAMPLE_PDF });
  assert.equal(result.success, true);
  assert.equal(result.data.text, 'Hello Maitask');
  assert.equal(result.data.pages, 1);
  assert.equal(result.data.uncompressedStreams, 1);
  assert.equal(result.data.compressedStreamsSkipped, 0);
  assert.equal(result.data.metadata.title, 'Sample Document');
  assert.equal(result.data.metadata.author, 'Maitask');
});

test('rejects non-PDF input', () => {
  const result = execute({ text: 'not a pdf' });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'PDF_INVALID_HEADER');
});

test('rejects encrypted PDFs', () => {
  const result = execute({ text: ENCRYPTED_PDF });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'PDF_ENCRYPTED');
});

test('requires content', () => {
  const result = execute({});
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'PDF_INPUT_REQUIRED');
});

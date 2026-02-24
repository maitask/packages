/**
 * @maitask/file-transformer
 * Structured data transformation between JSON/CSV/XML/YAML/TOML
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const from = normalizeFormat(payload.from);
    const to = normalizeFormat(payload.to);
    const source = payload.data;

    if (source == null) {
      throw new Error('data is required');
    }

    const parsed = parseData(source, from);
    const output = serializeData(parsed, to);

    return {
      success: true,
      data: {
        from,
        to,
        output
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'FILE_TRANSFORMER_ERROR', 'FileTransformerError');
  }
}

execute;

function normalizeFormat(value) {
  const format = String(value || '').trim().toLowerCase();
  if (['json', 'csv', 'xml', 'yaml', 'toml'].includes(format)) {
    return format;
  }
  throw new Error(`Unsupported format '${value}'. Use json/csv/xml/yaml/toml.`);
}

function parseData(data, format) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);

  switch (format) {
    case 'json':
      return typeof data === 'string' ? JSON.parse(data) : data;
    case 'csv':
      return parseCsv(text);
    case 'xml':
      return parseXml(text);
    case 'yaml':
      return parseSimpleYaml(text);
    case 'toml':
      return parseSimpleToml(text);
    default:
      throw new Error(`Unsupported input format '${format}'`);
  }
}

function serializeData(data, format) {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'csv':
      return toCsv(data);
    case 'xml':
      return toXml(data);
    case 'yaml':
      return toSimpleYaml(data);
    case 'toml':
      return toSimpleToml(data);
    default:
      throw new Error(`Unsupported output format '${format}'`);
  }
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(item => item.trim());

  return lines.slice(1).map(line => {
    const values = line.split(',').map(item => item.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header || `column_${index + 1}`] = values[index] ?? '';
    });
    return row;
  });
}

function toCsv(data) {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return '';

  const headers = Object.keys(asObject(rows[0]));
  const body = rows.map(row =>
    headers
      .map(header => escapeCsvCell(row?.[header]))
      .join(',')
  );

  return [headers.join(','), ...body].join('\n');
}

function escapeCsvCell(value) {
  const raw = value == null ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function parseXml(text) {
  const result = {};
  const regex = /<([A-Za-z0-9_\-]+)>([^<]*)<\/\1>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    result[match[1]] = match[2];
  }

  return result;
}

function toXml(data, root = 'root') {
  const rows = Array.isArray(data) ? data : [data];
  const items = rows
    .map(row => {
      const objectRow = asObject(row);
      const fields = Object.entries(objectRow)
        .map(([key, value]) => `<${escapeXmlTag(key)}>${escapeXmlText(value)}</${escapeXmlTag(key)}>`)
        .join('');
      return `<item>${fields}</item>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?><${root}>${items}</${root}>`;
}

function escapeXmlTag(value) {
  return String(value).replace(/[^A-Za-z0-9_\-]/g, '_');
}

function escapeXmlText(value) {
  const text = value == null ? '' : String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseSimpleYaml(text) {
  return parseLineKeyValue(text, ':');
}

function parseSimpleToml(text) {
  return parseLineKeyValue(text, '=');
}

function parseLineKeyValue(text, separator) {
  const result = {};
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf(separator);
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    result[key] = unquoteValue(value);
  }

  return result;
}

function unquoteValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function toSimpleYaml(data) {
  const objectData = asObject(data);
  return Object.entries(objectData)
    .map(([key, value]) => `${key}: ${serializeScalar(value)}`)
    .join('\n');
}

function toSimpleToml(data) {
  const objectData = asObject(data);
  return Object.entries(objectData)
    .map(([key, value]) => `${key} = ${serializeScalar(value)}`)
    .join('\n');
}

function serializeScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value == null) {
    return '""';
  }
  return JSON.stringify(String(value));
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('input must be an object');
  }
  return value;
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

/**
 * @maitask/file-transformer
 * Structured data transformation between JSON/CSV/XML/YAML/TOML.
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const config = buildConfig(payload, options);
    const from = normalizeFormat(payload.from);
    const to = normalizeFormat(payload.to);
    const source = payload.data;

    if (source == null) {
      throw new Error('data is required');
    }

    const parsed = parseData(source, from, config);
    const output = serializeData(parsed, to, config);
    const resultData = { from, to, output };
    if (config.includeParsed) {
      resultData.parsed = parsed;
    }

    return {
      success: true,
      data: resultData,
      metadata: {
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'FILE_TRANSFORMER_ERROR', 'FileTransformerError');
  }
}

function buildConfig(payload, options) {
  const merged = { ...options, ...payload.options };
  return {
    csvDelimiter: readSingleChar(merged.csvDelimiter || merged.delimiter, ','),
    csvQuote: readSingleChar(merged.csvQuote || merged.quote, '"'),
    csvHeader: merged.csvHeader !== false && merged.header !== false,
    csvHeaders: Array.isArray(merged.headers) ? merged.headers.map(String) : null,
    inferTypes: merged.inferTypes !== false,
    includeParsed: merged.includeParsed === true,
    xmlRootName: merged.xmlRootName || merged.rootName || 'root',
    xmlItemName: merged.xmlItemName || merged.itemName || 'item',
    xmlDeclaration: merged.xmlDeclaration !== false,
    yamlIndent: Number.isFinite(Number(merged.yamlIndent)) ? Math.max(2, Number(merged.yamlIndent)) : 2
  };
}

function normalizeFormat(value) {
  const format = String(value || '').trim().toLowerCase();
  if (['json', 'csv', 'xml', 'yaml', 'toml'].includes(format)) {
    return format;
  }
  throw new Error(`Unsupported format '${value}'. Use json/csv/xml/yaml/toml.`);
}

function parseData(data, format, config) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);

  switch (format) {
    case 'json':
      return typeof data === 'string' ? JSON.parse(data) : data;
    case 'csv':
      return parseCsv(text, config);
    case 'xml':
      return parseXml(text);
    case 'yaml':
      return parseYaml(text);
    case 'toml':
      return parseToml(text);
    default:
      throw new Error(`Unsupported input format '${format}'`);
  }
}

function serializeData(data, format, config) {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'csv':
      return toCsv(data, config);
    case 'xml':
      return toXml(data, config);
    case 'yaml':
      return toYaml(data, config);
    case 'toml':
      return toToml(data);
    default:
      throw new Error(`Unsupported output format '${format}'`);
  }
}

function parseCsv(text, config) {
  const rows = parseCsvRows(String(text || ''), config.csvDelimiter, config.csvQuote);
  if (rows.length === 0) return [];

  if (config.csvHeader) {
    const rawHeaders = config.csvHeaders || rows.shift();
    const headers = makeUniqueHeaders(rawHeaders);
    return rows.map(row => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = parseDelimitedScalar(row[index] ?? '', config);
      });
      return item;
    });
  }

  return rows.map(row => row.map(value => parseDelimitedScalar(value, config)));
}

function parseCsvRows(text, delimiter, quote) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let lastWasRowBreak = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      lastWasRowBreak = false;
      continue;
    }

    if (char === quote && field === '') {
      inQuotes = true;
      lastWasRowBreak = false;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      lastWasRowBreak = false;
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      lastWasRowBreak = true;
      continue;
    }

    field += char;
    lastWasRowBreak = false;
  }

  if (inQuotes) {
    throw new Error('Unclosed quoted CSV field');
  }

  if (!lastWasRowBreak || field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(item => item.length > 1 || item[0] !== '');
}

function toCsv(data, config) {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return '';

  if (rows.every(Array.isArray)) {
    return rows
      .map(row => row.map(value => escapeCsvCell(value, config)).join(config.csvDelimiter))
      .join('\n');
  }

  const objectRows = rows.map(row => asRecord(row));
  const headers = config.csvHeaders || collectHeaders(objectRows);
  const body = objectRows.map(row =>
    headers
      .map(header => escapeCsvCell(row[header], config))
      .join(config.csvDelimiter)
  );

  return [headers.map(header => escapeCsvCell(header, config)).join(config.csvDelimiter), ...body].join('\n');
}

function escapeCsvCell(value, config) {
  const raw = value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  const mustQuote = raw.includes(config.csvDelimiter)
    || raw.includes(config.csvQuote)
    || raw.includes('\n')
    || raw.includes('\r')
    || /^\s|\s$/.test(raw);

  if (!mustQuote) return raw;
  return config.csvQuote + raw.split(config.csvQuote).join(config.csvQuote + config.csvQuote) + config.csvQuote;
}

function makeUniqueHeaders(headers) {
  const seen = {};
  return headers.map((header, index) => {
    const base = String(header || `column_${index + 1}`).trim() || `column_${index + 1}`;
    const count = (seen[base] || 0) + 1;
    seen[base] = count;
    return count === 1 ? base : `${base}_${count}`;
  });
}

function collectHeaders(rows) {
  const headers = [];
  const seen = new Set();
  rows.forEach(row => {
    Object.keys(row).forEach(key => {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    });
  });
  return headers;
}

function parseDelimitedScalar(value, config) {
  return config.inferTypes ? parseScalar(String(value).trim()) : value;
}

function parseXml(text) {
  const root = { name: '#document', attributes: {}, children: [] };
  const stack = [root];
  const source = String(text || '');
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '<') {
      const next = source.indexOf('<', index);
      const content = source.slice(index, next === -1 ? source.length : next);
      appendXmlText(stack[stack.length - 1], content);
      index = next === -1 ? source.length : next;
      continue;
    }

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end === -1) throw new Error('Unclosed XML comment');
      index = end + 3;
      continue;
    }

    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9);
      if (end === -1) throw new Error('Unclosed XML CDATA section');
      appendXmlText(stack[stack.length - 1], source.slice(index + 9, end), true);
      index = end + 3;
      continue;
    }

    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2);
      if (end === -1) throw new Error('Unclosed XML processing instruction');
      index = end + 2;
      continue;
    }

    if (source.startsWith('<!', index)) {
      const end = source.indexOf('>', index + 2);
      if (end === -1) throw new Error('Unclosed XML declaration');
      index = end + 1;
      continue;
    }

    const close = source.indexOf('>', index + 1);
    if (close === -1) throw new Error('Unclosed XML tag');

    const raw = source.slice(index + 1, close).trim();
    if (raw.startsWith('/')) {
      const closingName = raw.slice(1).trim();
      const current = stack.pop();
      if (!current || current.name !== closingName) {
        throw new Error(`Mismatched XML closing tag: ${closingName}`);
      }
      index = close + 1;
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const tagSource = selfClosing ? raw.slice(0, -1).trim() : raw;
    const parsed = parseXmlTag(tagSource);
    const node = { name: parsed.name, attributes: parsed.attributes, children: [] };
    stack[stack.length - 1].children.push(node);

    if (!selfClosing) {
      stack.push(node);
    }

    index = close + 1;
  }

  if (stack.length !== 1) {
    throw new Error(`Unclosed XML tag: ${stack[stack.length - 1].name}`);
  }

  const elementChildren = root.children.filter(child => child.type !== 'text');
  if (elementChildren.length === 1) {
    return { [elementChildren[0].name]: xmlNodeToValue(elementChildren[0]) };
  }
  return { root: elementChildren.map(xmlNodeToValue) };
}

function appendXmlText(node, value, preserve) {
  if (!value) return;
  const content = preserve ? value : value.replace(/\s+/g, ' ').trim();
  if (!content) return;
  node.children.push({ type: 'text', value: decodeXml(content) });
}

function parseXmlTag(source) {
  const nameMatch = source.match(/^([A-Za-z_][\w:.-]*)/);
  if (!nameMatch) throw new Error(`Invalid XML tag: ${source}`);

  const name = nameMatch[1];
  const attrSource = source.slice(name.length);
  const attributes = {};
  const regex = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = regex.exec(attrSource)) !== null) {
    attributes[match[1]] = decodeXml(match[3] !== undefined ? match[3] : match[4]);
  }

  return { name, attributes };
}

function xmlNodeToValue(node) {
  const elementChildren = node.children.filter(child => child.type !== 'text');
  const text = node.children
    .filter(child => child.type === 'text')
    .map(child => child.value)
    .join('')
    .trim();
  const hasAttributes = Object.keys(node.attributes).length > 0;

  if (!hasAttributes && elementChildren.length === 0) {
    return text;
  }

  const value = {};
  if (hasAttributes) value._attributes = node.attributes;
  if (text) value._text = text;

  elementChildren.forEach(child => {
    const childValue = xmlNodeToValue(child);
    if (Object.prototype.hasOwnProperty.call(value, child.name)) {
      if (!Array.isArray(value[child.name])) value[child.name] = [value[child.name]];
      value[child.name].push(childValue);
    } else {
      value[child.name] = childValue;
    }
  });

  return value;
}

function toXml(data, config) {
  const rootInfo = chooseXmlRoot(data, config.xmlRootName);
  const body = Array.isArray(rootInfo.value)
    ? `<${rootInfo.name}>${rootInfo.value.map(item => serializeXmlElement(config.xmlItemName, item, config)).join('')}</${rootInfo.name}>`
    : serializeXmlElement(rootInfo.name, rootInfo.value, config);
  return (config.xmlDeclaration ? '<?xml version="1.0" encoding="UTF-8"?>' : '') + body;
}

function chooseXmlRoot(data, fallbackName) {
  if (isPlainObject(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1 && !isXmlSpecialKey(keys[0])) {
      return { name: sanitizeXmlName(keys[0]), value: data[keys[0]] };
    }
  }
  return { name: sanitizeXmlName(fallbackName || 'root'), value: data };
}

function serializeXmlElement(name, value, config) {
  const tag = sanitizeXmlName(name);
  if (Array.isArray(value)) {
    return value.map(item => serializeXmlElement(tag, item, config)).join('');
  }

  if (isPlainObject(value)) {
    const attrs = isPlainObject(value._attributes) ? value._attributes : {};
    const attrText = Object.entries(attrs)
      .map(([key, attrValue]) => ` ${sanitizeXmlName(key)}="${escapeXmlAttribute(attrValue)}"`)
      .join('');
    const childKeys = Object.keys(value).filter(key => !isXmlSpecialKey(key));
    const text = Object.prototype.hasOwnProperty.call(value, '_text') ? escapeXmlText(value._text) : '';
    const children = childKeys.map(key => serializeXmlElement(key, value[key], config)).join('');

    if (!text && !children) {
      return `<${tag}${attrText}/>`;
    }
    return `<${tag}${attrText}>${text}${children}</${tag}>`;
  }

  return `<${tag}>${escapeXmlText(value)}</${tag}>`;
}

function parseYaml(text) {
  const lines = prepareYamlLines(String(text || ''));
  if (lines.length === 0) return {};
  const [value] = parseYamlBlock(lines, 0, lines[0].indent);
  return value;
}

function prepareYamlLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => ({ indent: countIndent(line), text: stripComment(line).trim() }))
    .filter(line => line.text);
}

function parseYamlBlock(lines, index, indent) {
  if (index >= lines.length) return [{}, index];
  if (lines[index].indent < indent) return [{}, index];
  return lines[index].text.startsWith('-')
    ? parseYamlSequence(lines, index, indent)
    : parseYamlMapping(lines, index, indent);
}

function parseYamlSequence(lines, index, indent) {
  const result = [];

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== indent || !line.text.startsWith('-')) break;

    const rest = line.text.slice(1).trim();
    index++;

    if (!rest) {
      const nestedIndent = nextNestedIndent(lines, index, indent);
      const parsed = parseYamlBlock(lines, index, nestedIndent);
      result.push(parsed[0]);
      index = parsed[1];
      continue;
    }

    if (isYamlKeyValue(rest)) {
      const item = {};
      const pair = splitYamlKeyValue(rest);
      if (pair.value === '') {
        const nestedIndent = nextNestedIndent(lines, index, indent);
        const parsed = parseYamlBlock(lines, index, nestedIndent);
        item[pair.key] = parsed[0];
        index = parsed[1];
      } else {
        item[pair.key] = parseScalar(pair.value);
      }

      if (index < lines.length && lines[index].indent > indent) {
        const parsed = parseYamlMapping(lines, index, lines[index].indent);
        Object.assign(item, parsed[0]);
        index = parsed[1];
      }

      result.push(item);
    } else {
      result.push(parseScalar(rest));
    }
  }

  return [result, index];
}

function parseYamlMapping(lines, index, indent) {
  const result = {};

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== indent || line.text.startsWith('-')) break;
    if (!isYamlKeyValue(line.text)) {
      throw new Error(`Invalid YAML mapping line: ${line.text}`);
    }

    const pair = splitYamlKeyValue(line.text);
    index++;

    if (pair.value === '') {
      const nestedIndent = nextNestedIndent(lines, index, indent);
      const parsed = parseYamlBlock(lines, index, nestedIndent);
      result[pair.key] = parsed[0];
      index = parsed[1];
    } else {
      result[pair.key] = parseScalar(pair.value);
    }
  }

  return [result, index];
}

function toYaml(data, config) {
  return serializeYamlValue(data, 0, config).replace(/\n$/, '');
}

function serializeYamlValue(value, indent, config) {
  const pad = ' '.repeat(indent);
  const nextIndent = indent + config.yamlIndent;

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map(item => {
      if (isPlainObject(item) || Array.isArray(item)) {
        const nested = serializeYamlValue(item, nextIndent, config);
        return `${pad}-\n${nested}`;
      }
      return `${pad}- ${formatYamlScalar(item)}`;
    }).join('\n');
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return entries.map(([key, item]) => {
      if (isPlainObject(item) || Array.isArray(item)) {
        const nested = serializeYamlValue(item, nextIndent, config);
        return `${pad}${key}:\n${nested}`;
      }
      return `${pad}${key}: ${formatYamlScalar(item)}`;
    }).join('\n');
  }

  return `${pad}${formatYamlScalar(value)}`;
}

function parseToml(text) {
  const result = {};
  let current = result;

  String(text || '').split(/\r?\n/).forEach(rawLine => {
    const line = stripComment(rawLine).trim();
    if (!line) return;

    const arraySection = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arraySection) {
      current = pushTomlArrayTable(result, splitTomlPath(arraySection[1]));
      return;
    }

    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = ensurePath(result, splitTomlPath(section[1]));
      return;
    }

    const eq = findTopLevelChar(line, '=');
    if (eq === -1) throw new Error(`Invalid TOML line: ${line}`);

    const keyPath = splitTomlPath(line.slice(0, eq).trim());
    const value = parseTomlValue(line.slice(eq + 1).trim());
    setPath(current, keyPath, value);
  });

  return result;
}

function parseTomlValue(value) {
  return parseScalar(value, true);
}

function toToml(data) {
  const objectData = asRecord(data);
  const lines = [];
  writeTomlObject(objectData, '', lines);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function writeTomlObject(objectData, path, lines) {
  const nested = [];
  const arrays = [];

  Object.entries(objectData).forEach(([key, value]) => {
    if (Array.isArray(value) && value.every(isPlainObject)) {
      arrays.push([key, value]);
      return;
    }
    if (isPlainObject(value)) {
      nested.push([key, value]);
      return;
    }
    lines.push(`${key} = ${formatTomlValue(value)}`);
  });

  nested.forEach(([key, value]) => {
    const nextPath = path ? `${path}.${key}` : key;
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`[${nextPath}]`);
    writeTomlObject(value, nextPath, lines);
  });

  arrays.forEach(([key, values]) => {
    const nextPath = path ? `${path}.${key}` : key;
    values.forEach(item => {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(`[[${nextPath}]]`);
      writeTomlObject(item, nextPath, lines);
    });
  });
}

function parseScalar(raw, tomlMode) {
  const value = String(raw ?? '').trim();
  if (value === '') return '';
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquoteString(value);
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? splitTopLevel(inner, ',').map(item => parseScalar(item, tomlMode)) : [];
  }

  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const result = {};
    if (!inner) return result;
    splitTopLevel(inner, ',').forEach(part => {
      const separator = tomlMode ? findTopLevelChar(part, '=') : findTopLevelChar(part, ':');
      if (separator === -1) throw new Error(`Invalid inline object entry: ${part}`);
      const key = unquoteString(part.slice(0, separator).trim());
      result[key] = parseScalar(part.slice(separator + 1), tomlMode);
    });
    return result;
  }

  if (/^[+-]?\d+$/.test(value)) return Number(value);
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
  return value;
}

function unquoteString(value) {
  const text = String(value).trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function formatYamlScalar(value) {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  if (/^[A-Za-z0-9_./-]+$/.test(text) && !/^(true|false|null|~)$/i.test(text)) return text;
  return JSON.stringify(text);
}

function formatTomlValue(value) {
  if (value == null) return '""';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(formatTomlValue).join(', ')}]`;
  if (isPlainObject(value)) {
    return `{ ${Object.entries(value).map(([key, item]) => `${key} = ${formatTomlValue(item)}`).join(', ')} }`;
  }
  return JSON.stringify(String(value));
}

function isYamlKeyValue(text) {
  return findTopLevelChar(text, ':') > 0;
}

function splitYamlKeyValue(text) {
  const index = findTopLevelChar(text, ':');
  return {
    key: unquoteString(text.slice(0, index).trim()),
    value: text.slice(index + 1).trim()
  };
}

function stripComment(line) {
  let quote = null;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote && line[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (char === '#' && bracketDepth === 0 && braceDepth === 0) {
      return line.slice(0, i);
    }
  }

  return line;
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let current = '';
  let quote = null;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      current += char;
      if (char === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1);

    if (char === delimiter && bracketDepth === 0 && braceDepth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findTopLevelChar(text, target) {
  let quote = null;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (char === target && bracketDepth === 0 && braceDepth === 0) return i;
  }

  return -1;
}

function countIndent(line) {
  const match = String(line).match(/^ */);
  return match ? match[0].length : 0;
}

function nextNestedIndent(lines, index, currentIndent) {
  if (index >= lines.length || lines[index].indent <= currentIndent) {
    return currentIndent + 2;
  }
  return lines[index].indent;
}

function splitTomlPath(path) {
  return splitTopLevel(path, '.').map(part => unquoteString(part.trim()));
}

function ensurePath(root, path) {
  let current = root;
  path.forEach(part => {
    if (!isPlainObject(current[part])) current[part] = {};
    current = current[part];
  });
  return current;
}

function setPath(root, path, value) {
  const last = path[path.length - 1];
  const parent = ensurePath(root, path.slice(0, -1));
  parent[last] = value;
}

function pushTomlArrayTable(root, path) {
  const last = path[path.length - 1];
  const parent = ensurePath(root, path.slice(0, -1));
  if (!Array.isArray(parent[last])) parent[last] = [];
  const item = {};
  parent[last].push(item);
  return item;
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function sanitizeXmlName(value) {
  const name = String(value || 'item').replace(/[^A-Za-z0-9_.:-]/g, '_');
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

function isXmlSpecialKey(key) {
  return key === '_attributes' || key === '_text';
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('input must be an object');
  }
  return value;
}

function asRecord(value) {
  if (isPlainObject(value)) return value;
  if (value == null) return {};
  return { value };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSingleChar(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value)[0];
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

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

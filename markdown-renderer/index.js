/**
 * @maitask/markdown-renderer
 * Markdown to HTML converter with safe links, code-block preservation, and template support.
 *
 * @version 0.1.1
 * @author Maitask Team
 * @license MIT
 */

function execute(input, options = {}, context = {}) {
    try {
        const markdown = ensureMarkdown(input);
        const format = options.format || 'html';

        let result;
        if (format === 'html') {
            result = renderHtml(markdown, options);
        } else if (format === 'plain') {
            result = renderPlain(markdown);
        } else {
            throw new Error(`Unknown format: ${format}`);
        }

        return {
            success: true,
            data: {
                format,
                content: result
            },
            metadata: {
                package: '@maitask/markdown-renderer',
                length: result.length,
                timestamp: new Date().toISOString(),
                version: '0.1.1'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Rendering error',
                code: 'RENDER_ERROR',
                type: error?.name || 'RenderError'
            },
            metadata: {
                package: '@maitask/markdown-renderer',
                timestamp: new Date().toISOString(),
                version: '0.1.1'
            }
        };
    }
}

if (typeof module !== 'undefined') {
    module.exports = { execute };
}
execute;

function ensureMarkdown(input) {
    if (typeof input === 'string') {
        return input;
    }

    if (input && typeof input.text === 'string') {
        return input.text;
    }

    if (input && typeof input.content === 'string') {
        return input.content;
    }

    throw new Error('Invalid input: string or {text} expected');
}

function renderHtml(markdown, options = {}) {
    const codeTokens = [];
    const reserveToken = htmlSnippet => {
        const idx = codeTokens.length;
        codeTokens.push(htmlSnippet);
        return `@@MAITASK_CODE_${idx}@@`;
    };

    let html = String(markdown).replace(/\r\n/g, '\n');

    html = html.replace(/```([A-Za-z0-9_-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
        const escaped = escapeHtml(code.trimEnd());
        const safeLang = lang ? escapeHtmlAttr(lang) : '';
        const language = safeLang ? ` class="language-${safeLang}"` : '';
        return reserveToken(`<pre><code${language}>${escaped}</code></pre>`);
    });

    html = html.replace(/`([^`\n]+)`/g, (_match, code) => reserveToken(`<code>${escapeHtml(code)}</code>`));

    if (options.sanitize !== false) {
        html = escapeHtml(html);
    }

    html = processImages(html);
    html = processLinks(html);
    html = processHeadings(html);
    html = processBold(html);
    html = processItalic(html);
    html = processBlockquotes(html);
    html = processHorizontalRules(html);
    html = processLists(html);
    html = processTables(html);
    html = processParagraphs(html);

    html = html.replace(/@@MAITASK_CODE_(\d+)@@/g, (_match, rawIndex) => {
        const idx = Number(rawIndex);
        return Number.isInteger(idx) && idx >= 0 && idx < codeTokens.length ? codeTokens[idx] : '';
    });

    if (options.template) {
        html = applyTemplate(html, options.template, options.templateVars || {});
    }

    return html;
}

function renderPlain(markdown) {
    let text = String(markdown);

    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/#{1,6}\s+/g, '');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/^>\s+/gm, '');
    text = text.replace(/^[-*+]\s+/gm, '');
    text = text.replace(/^\d+\.\s+/gm, '');

    return text.trim();
}

function sanitizeSafeUrl(rawUrl, allowDataImage = false) {
    const trimmed = String(rawUrl || '').trim().replace(/[\u0000-\u0020\u007f]/g, '');
    if (!trimmed) return '#';
    if (trimmed.startsWith('#') || (trimmed.startsWith('/') && !trimmed.startsWith('//'))) {
        return trimmed;
    }
    if (allowDataImage && /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
        return trimmed;
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
            return parsed.toString();
        }
    } catch {
        // Reject unparseable or dangerous schemes (e.g. javascript:, vbscript:, data:text/html)
    }
    return '#';
}

function processHeadings(text) {
    return text.replace(/^(#{1,6})\s+(.+)$/gm, (_match, hashes, content) => {
        const level = hashes.length;
        const id = content.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
        return `<h${level} id="${escapeHtmlAttr(id)}">${content}</h${level}>`;
    });
}

function processBold(text) {
    return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
               .replace(/__([^_]+)__/g, '<strong>$1</strong>');
}

function processItalic(text) {
    return text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
               .replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
}

function processLinks(text) {
    return text.replace(/\[([^\]]+)\]\(((?:[^()\s]+|\([^()\s]*\))+)\)/g, (_match, label, href) => {
        const safeHref = escapeHtmlAttr(sanitizeSafeUrl(unescapeHtmlBasic(href), false));
        return `<a href="${safeHref}">${label}</a>`;
    });
}

function processImages(text) {
    return text.replace(/!\[([^\]]*)\]\(((?:[^()\s]+|\([^()\s]*\))+)\)/g, (_match, alt, src) => {
        const safeSrc = escapeHtmlAttr(sanitizeSafeUrl(unescapeHtmlBasic(src), true));
        const safeAlt = escapeHtmlAttr(alt);
        return `<img src="${safeSrc}" alt="${safeAlt}" />`;
    });
}

function processBlockquotes(text) {
    const lines = text.split('\n');
    const result = [];
    let inBlockquote = false;
    let blockquoteLines = [];

    for (const line of lines) {
        if (/^(&gt;|>)/.test(line.trim())) {
            inBlockquote = true;
            blockquoteLines.push(line.replace(/^(?:&gt;|>)\s?/, ''));
        } else {
            if (inBlockquote) {
                result.push(`<blockquote>${blockquoteLines.join('\n')}</blockquote>`);
                blockquoteLines = [];
                inBlockquote = false;
            }
            result.push(line);
        }
    }

    if (inBlockquote) {
        result.push(`<blockquote>${blockquoteLines.join('\n')}</blockquote>`);
    }

    return result.join('\n');
}

function processHorizontalRules(text) {
    return text.replace(/^([-*_])\1{2,}$/gm, '<hr />');
}

function processLists(text) {
    const lines = text.split('\n');
    const result = [];
    let inList = false;
    let listType = null;
    let listItems = [];

    for (const line of lines) {
        const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
        const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);

        if (ulMatch) {
            if (!inList || listType !== 'ul') {
                if (inList) {
                    result.push(closeList(listType, listItems));
                    listItems = [];
                }
                inList = true;
                listType = 'ul';
            }
            listItems.push(ulMatch[3]);
        } else if (olMatch) {
            if (!inList || listType !== 'ol') {
                if (inList) {
                    result.push(closeList(listType, listItems));
                    listItems = [];
                }
                inList = true;
                listType = 'ol';
            }
            listItems.push(olMatch[3]);
        } else {
            if (inList) {
                result.push(closeList(listType, listItems));
                listItems = [];
                inList = false;
                listType = null;
            }
            result.push(line);
        }
    }

    if (inList) {
        result.push(closeList(listType, listItems));
    }

    return result.join('\n');
}

function closeList(type, items) {
    const itemsHtml = items.map(item => `  <li>${item}</li>`).join('\n');
    return `<${type}>\n${itemsHtml}\n</${type}>`;
}

function processTables(text) {
    const lines = text.split('\n');
    const result = [];
    let inTable = false;
    let tableLines = [];

    for (const line of lines) {
        if (line.includes('|') && !/^@@MAITASK_CODE_\d+@@$/.test(line.trim())) {
            inTable = true;
            tableLines.push(line);
        } else {
            if (inTable) {
                result.push(renderTable(tableLines));
                tableLines = [];
                inTable = false;
            }
            result.push(line);
        }
    }

    if (inTable) {
        result.push(renderTable(tableLines));
    }

    return result.join('\n');
}

function renderTable(lines) {
    if (lines.length < 2) return lines.join('\n');

    const headerLine = lines[0];
    const separatorLine = lines[1];
    const bodyLines = lines.slice(2);

    if (!separatorLine.match(/^\|?[\s:-]+\|/)) {
        return lines.join('\n');
    }

    const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
    const rows = bodyLines.map(line =>
        line.split('|').map(c => c.trim()).filter(c => c)
    );

    let html = '<table>\n<thead>\n<tr>';
    headers.forEach(h => {
        html += `<th>${h}</th>`;
    });
    html += '</tr>\n</thead>\n<tbody>\n';

    rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => {
            html += `<td>${cell}</td>`;
        });
        html += '</tr>\n';
    });

    html += '</tbody>\n</table>';
    return html;
}

function processParagraphs(text) {
    const lines = text.split('\n');
    const result = [];
    let inParagraph = false;
    let paragraphLines = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
            if (inParagraph) {
                result.push(`<p>${paragraphLines.join(' ')}</p>`);
                paragraphLines = [];
                inParagraph = false;
            }
            result.push('');
        } else if (trimmed.startsWith('<') || /^@@MAITASK_CODE_\d+@@$/.test(trimmed)) {
            if (inParagraph) {
                result.push(`<p>${paragraphLines.join(' ')}</p>`);
                paragraphLines = [];
                inParagraph = false;
            }
            result.push(line);
        } else {
            inParagraph = true;
            paragraphLines.push(trimmed);
        }
    }

    if (inParagraph) {
        result.push(`<p>${paragraphLines.join(' ')}</p>`);
    }

    return result.join('\n');
}

function applyTemplate(content, template, vars) {
    const safeVars = vars && typeof vars === 'object' ? vars : {};
    return String(template).replace(/\{\{([^}]+)\}\}/g, (match, rawKey) => {
        const key = rawKey.trim();
        if (key === 'content') return content;
        if (Object.hasOwn(safeVars, key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
            return escapeHtml(String(safeVars[key]));
        }
        return match;
    });
}

function unescapeHtmlBasic(text) {
    return String(text)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function escapeHtmlAttr(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(text).replace(/[&<>"']/g, char => map[char]);
}

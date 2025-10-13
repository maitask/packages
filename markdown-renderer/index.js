/**
 * @maitask/markdown-renderer
 * Markdown to HTML converter with template support
 *
 * Features:
 * - Convert Markdown to HTML
 * - Template rendering
 * - Code syntax highlighting placeholder
 * - Table support
 * - Lists and nested structures
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input markdown content
 * @param {Object} options - Rendering options
 * @param {Object} context - Execution context
 * @returns {Object} Rendered HTML
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
            format,
            content: result,
            metadata: {
                length: result.length,
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Rendering error',
                code: 'RENDER_ERROR',
                type: error.constructor.name
            },
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

/**
 * Ensure input is markdown string
 */
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

/**
 * Render markdown to HTML
 */
function renderHtml(markdown, options = {}) {
    let html = markdown;

    html = processCodeBlocks(html);
    html = processInlineCode(html);
    html = processHeadings(html);
    html = processBold(html);
    html = processItalic(html);
    html = processLinks(html);
    html = processImages(html);
    html = processBlockquotes(html);
    html = processHorizontalRules(html);
    html = processLists(html);
    html = processTables(html);
    html = processParagraphs(html);

    if (options.template) {
        html = applyTemplate(html, options.template, options.templateVars || {});
    }

    return html;
}

/**
 * Render markdown to plain text
 */
function renderPlain(markdown) {
    let text = markdown;

    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/#{1,6}\s+/g, '');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    text = text.replace(/^>\s+/gm, '');
    text = text.replace(/^[-*+]\s+/gm, '');
    text = text.replace(/^\d+\.\s+/gm, '');

    return text.trim();
}

/**
 * Process code blocks
 */
function processCodeBlocks(text) {
    return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const escaped = escapeHtml(code.trim());
        const language = lang ? ` class="language-${lang}"` : '';
        return `<pre><code${language}>${escaped}</code></pre>`;
    });
}

/**
 * Process inline code
 */
function processInlineCode(text) {
    return text.replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Process headings
 */
function processHeadings(text) {
    return text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
        const level = hashes.length;
        const id = content.toLowerCase().replace(/[^\w]+/g, '-');
        return `<h${level} id="${id}">${content}</h${level}>`;
    });
}

/**
 * Process bold text
 */
function processBold(text) {
    return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
               .replace(/__([^_]+)__/g, '<strong>$1</strong>');
}

/**
 * Process italic text
 */
function processItalic(text) {
    return text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
               .replace(/_([^_]+)_/g, '<em>$1</em>');
}

/**
 * Process links
 */
function processLinks(text) {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Process images
 */
function processImages(text) {
    return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
}

/**
 * Process blockquotes
 */
function processBlockquotes(text) {
    const lines = text.split('\n');
    const result = [];
    let inBlockquote = false;
    let blockquoteLines = [];

    for (const line of lines) {
        if (line.trim().startsWith('>')) {
            inBlockquote = true;
            blockquoteLines.push(line.replace(/^>\s?/, ''));
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

/**
 * Process horizontal rules
 */
function processHorizontalRules(text) {
    return text.replace(/^([-*_])\1{2,}$/gm, '<hr />');
}

/**
 * Process lists
 */
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

/**
 * Close list and return HTML
 */
function closeList(type, items) {
    const itemsHtml = items.map(item => `  <li>${item}</li>`).join('\n');
    return `<${type}>\n${itemsHtml}\n</${type}>`;
}

/**
 * Process tables
 */
function processTables(text) {
    const lines = text.split('\n');
    const result = [];
    let inTable = false;
    let tableLines = [];

    for (const line of lines) {
        if (line.includes('|')) {
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

/**
 * Render table from lines
 */
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

/**
 * Process paragraphs
 */
function processParagraphs(text) {
    const lines = text.split('\n');
    const result = [];
    let inParagraph = false;
    let paragraphLines = [];

    for (const line of lines) {
        if (line.trim() === '') {
            if (inParagraph) {
                result.push(`<p>${paragraphLines.join(' ')}</p>`);
                paragraphLines = [];
                inParagraph = false;
            }
            result.push('');
        } else if (line.trim().startsWith('<')) {
            if (inParagraph) {
                result.push(`<p>${paragraphLines.join(' ')}</p>`);
                paragraphLines = [];
                inParagraph = false;
            }
            result.push(line);
        } else {
            inParagraph = true;
            paragraphLines.push(line.trim());
        }
    }

    if (inParagraph) {
        result.push(`<p>${paragraphLines.join(' ')}</p>`);
    }

    return result.join('\n');
}

/**
 * Apply HTML template
 */
function applyTemplate(content, template, vars) {
    let html = template;

    html = html.replace(/\{\{content\}\}/g, content);

    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        html = html.replace(regex, value);
    }

    return html;
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * @maitask/intelligence-briefing
 * Multi-source intelligence briefing generator with OpenAI-compatible analysis.
 *
 * The package is intentionally channel-neutral. It produces structured briefing
 * data and a bot-ready message; Plane output adapters deliver the result to
 * Telegram, DingTalk, Feishu, Discord, Slack, or other destinations.
 */

const PACKAGE_NAME = '@maitask/intelligence-briefing';
const PACKAGE_VERSION = '0.1.9';
const CONTRACT_VERSION = '2026-06-27';

async function execute(input = {}, options = {}, context = {}) {
  const startedAt = Date.now();

  try {
    const config = buildConfig(input, options, context);
    const collection = await collectStories(input, config);
    const selected = selectStories(collection.stories, config);
    const enriched = await enrichStories(selected, config);
    const briefing = await generateBriefing(enriched, config);
    briefing.message = finalizePublishedMessage(briefing, enriched, config);
    const message = briefing.message;
    const citations = buildCitations(enriched);
    const nextDedupeState = buildNextDedupeState(config, enriched);
    const items = buildOutputItems(enriched, briefing, citations);

    return {
      success: true,
      data: {
        items,
        summary: {
          total: items.length,
          success_count: items.length,
          failure_count: 0,
          metrics: {
            collected: collection.total,
            selected: selected.length,
            profile: config.analysis.profile,
            targetLanguage: config.analysis.targetLanguage,
            sources: collection.sources
          }
        },
        briefing: {
          ...briefing,
          message
        },
        message,
        nextDedupeState
      },
      error: null,
      metadata: {
        contract_version: CONTRACT_VERSION,
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        execution_id: context?.execution_id || null,
        profile: config.analysis.profile,
        target_language: config.analysis.targetLanguage,
        ai_provider: config.ai.enabled ? config.ai.provider : 'extractive',
        model: config.ai.enabled ? config.ai.model : null,
        product: config.output.product || null,
        briefing_title: briefing.title,
        briefing_summary: briefing.summary,
        channel_message: message,
        next_dedupe_state: nextDedupeState,
        execution_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      },
      citations
    };
  } catch (error) {
    return buildFailure(error, startedAt, context);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;

function buildConfig(input, options, context) {
  const root = isPlainObject(input) ? input : {};
  const opts = isPlainObject(options) ? options : {};
  const source = mergeObjects(opts, root);
  const analysisInput = mergeObjects(opts.analysis || {}, root.analysis || {});
  const selectionInput = mergeObjects(opts.selection || {}, root.selection || {});
  const outputInput = mergeObjects(opts.output || {}, root.output || {});
  const enrichmentInput = mergeObjects(opts.enrichment || {}, root.enrichment || {});
  const dedupeInput = mergeObjects(opts.dedupe || {}, root.dedupe || {});
  const aiInput = mergeObjects(
    mergeObjects(opts.ai || {}, root.ai || {}),
    mergeObjects(analysisInput.ai || {}, compactDefined({
      apiKey: opts.apiKey || opts.api_key || root.apiKey || root.api_key,
      baseUrl: opts.baseUrl || opts.base_url || root.baseUrl || root.base_url,
      model: opts.model || root.model,
      timeoutMs: firstDefined(opts.timeoutMs, opts.timeout_ms, root.timeoutMs, root.timeout_ms),
      retries: firstDefined(opts.retries, root.retries)
    }))
  );

  const targetLanguage = stringValue(
    analysisInput.targetLanguage ||
      analysisInput.target_language ||
      source.targetLanguage ||
      source.language ||
      'en'
  );
  const profile = normalizeProfile(analysisInput.profile || source.profile || 'technology');
  const aiProvider = stringValue(aiInput.provider || 'openai_compatible').toLowerCase();
  const aiDisabled =
    aiInput.enabled === false ||
    ['none', 'disabled', 'extractive', 'rule_based', 'rules'].includes(aiProvider);
  const apiKey =
    stringValue(aiInput.apiKey || aiInput.api_key) ||
    stringValue(context?.secrets?.INTELLIGENCE_API_KEY) ||
    stringValue(context?.secrets?.DEXPS_API_KEY) ||
    stringValue(context?.secrets?.OPENAI_API_KEY) ||
    stringValue(context?.env?.INTELLIGENCE_API_KEY) ||
    stringValue(context?.env?.DEXPS_API_KEY) ||
    stringValue(context?.env?.OPENAI_API_KEY);
  const baseUrl =
    stringValue(aiInput.baseUrl || aiInput.base_url) ||
    stringValue(context?.env?.DEXPS_BASE_URL) ||
    stringValue(context?.env?.OPENAI_BASE_URL) ||
    'https://api.openai.com/v1';

  const sources = normalizeSources(root, opts, context);

  return {
    sources,
    analysis: {
      profile,
      targetLanguage,
      depth: stringValue(analysisInput.depth || source.depth || 'standard'),
      focus: normalizeStringArray(analysisInput.focus || source.focus),
      customInstructions: stringValue(
        analysisInput.customInstructions || analysisInput.custom_instructions || ''
      ),
      audience: stringValue(analysisInput.audience || 'operator')
    },
    selection: {
      maxItems: boundedInt(selectionInput.maxItems ?? selectionInput.max_items ?? source.maxItems, 8, 1, 30),
      minScore: optionalNumber(selectionInput.minScore ?? selectionInput.min_score ?? source.minScore),
      minComments: optionalNumber(
        selectionInput.minComments ?? selectionInput.min_comments ?? source.minComments
      ),
      newerThanHours: optionalNumber(
        selectionInput.newerThanHours ?? selectionInput.newer_than_hours ?? source.newerThanHours
      ),
      keywords: normalizeStringArray(selectionInput.keywords || source.keywords),
      excludeKeywords: normalizeStringArray(
        selectionInput.excludeKeywords || selectionInput.exclude_keywords || source.excludeKeywords
      ),
      domains: normalizeStringArray(selectionInput.domains || source.domains).map(value =>
        value.toLowerCase()
      ),
      excludeDomains: normalizeStringArray(
        selectionInput.excludeDomains || selectionInput.exclude_domains || source.excludeDomains
      ).map(value => value.toLowerCase()),
      sortBy: stringValue(selectionInput.sortBy || selectionInput.sort_by || 'signal')
    },
    enrichment: {
      fetchArticleText: Boolean(
        enrichmentInput.fetchArticleText || enrichmentInput.fetch_article_text || false
      ),
      maxArticles: boundedInt(
        enrichmentInput.maxArticles ?? enrichmentInput.max_articles,
        3,
        0,
        10
      ),
      maxArticleChars: boundedInt(
        enrichmentInput.maxArticleChars ?? enrichmentInput.max_article_chars,
        4000,
        500,
        20000
      ),
      timeoutMs: boundedInt(enrichmentInput.timeoutMs ?? enrichmentInput.timeout_ms, 15000, 1000, 120000),
      retries: boundedInt(enrichmentInput.retries ?? enrichmentInput.retry_count, 2, 0, 6)
    },
    dedupe: {
      enabled: dedupeInput.enabled !== false,
      windowHours: boundedInt(
        dedupeInput.windowHours ?? dedupeInput.window_hours ?? source.dedupeWindowHours,
        72,
        1,
        24 * 365
      ),
      seen: normalizeSeenEntries(dedupeInput.seen || source.seen || root.seen),
      maxSeen: boundedInt(dedupeInput.maxSeen ?? dedupeInput.max_seen, 500, 10, 10000)
    },
    output: {
      format: stringValue(outputInput.format || 'channel_message'),
      product: normalizeProduct(
        outputInput.product || source.product || analysisInput.product || ''
      ),
      maxCharacters: boundedInt(
        outputInput.maxCharacters ?? outputInput.max_characters,
        3500,
        500,
        30000
      ),
      includeSources: outputInput.includeSources !== false && outputInput.include_sources !== false,
      includeMetadata: Boolean(outputInput.includeMetadata || outputInput.include_metadata || false)
    },
    ai: {
      enabled: !aiDisabled,
      provider: aiProvider,
      apiKey,
      baseUrl: normalizeBaseUrl(baseUrl),
      endpoint: stringValue(aiInput.endpoint || ''),
      model: stringValue(aiInput.model || 'gpt-4o-mini'),
      temperature: readNumber(aiInput.temperature, 0.2),
      maxTokens: boundedInt(aiInput.maxTokens ?? aiInput.max_tokens, 1800, 200, 12000),
      timeoutMs: boundedInt(
        firstDefined(aiInput.timeoutMs, aiInput.timeout_ms),
        60000,
        1000,
        300000
      ),
      retries: boundedInt(firstDefined(aiInput.retries, aiInput.retry_count), 2, 0, 5),
      jsonMode: aiInput.jsonMode === true || aiInput.json_mode === true
    }
  };
}

function normalizeSources(input, options, context) {
  const explicit = input.sources || options.sources || input.source || options.source;
  const list = Array.isArray(explicit) ? explicit : explicit ? [explicit] : [];
  const normalized = list
    .map(source => {
      if (typeof source === 'string') return { type: source };
      return isPlainObject(source) ? { ...source } : null;
    })
    .filter(Boolean)
    .map(source => {
      const type = stringValue(source.type || 'hackernews').toLowerCase();
      if (type === 'hn') source.type = 'hackernews';
      else source.type = type;
      return source;
    });

  const hasInlineStories = extractInlineStories(input).length > 0;
  if (!normalized.length && !hasInlineStories) {
    normalized.push({
      type: 'hackernews',
      storyTypes: [input.storyType || options.storyType || 'top'],
      limit: input.limit || options.limit || 30,
      includeComments: Boolean(input.includeComments || options.includeComments),
      commentLimit: input.commentLimit ?? options.commentLimit ?? 5,
      commentDepth: input.commentDepth ?? options.commentDepth ?? 1,
      apiBaseUrl:
        input.apiBaseUrl ||
        options.apiBaseUrl ||
        context?.env?.HACKERNEWS_API_BASE_URL ||
        'https://hacker-news.firebaseio.com/v0'
    });
  }

  return normalized;
}

async function collectStories(input, config) {
  const stories = [];
  const inline = extractInlineStories(input);
  for (const story of inline) {
    const normalized = normalizeStory(story, 'input');
    if (normalized) stories.push(normalized);
  }

  const sourceResults = await mapWithConcurrency(config.sources, 4, async source => {
    if (source.type === 'hackernews') {
      return await fetchHackerNewsSource(source);
    } else if (source.type === 'items' || source.type === 'inline') {
      const sourceItems = extractInlineStories(source);
      const out = [];
      for (const item of sourceItems) {
        const normalized = normalizeStory(item, source.name || 'inline');
        if (normalized) out.push(normalized);
      }
      return out;
    } else {
      throw new Error(`Unsupported intelligence source: ${source.type}`);
    }
  });

  for (const sourceStories of sourceResults) {
    stories.push(...sourceStories);
  }

  const unique = [];
  const seen = new Set();
  for (const story of stories) {
    const key = story.key;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(story);
  }

  return {
    total: unique.length,
    stories: unique,
    sources: [...new Set(unique.map(story => story.source))]
  };
}

function extractInlineStories(input) {
  const out = [];
  const seen = new WeakSet();

  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlainObject(value) || seen.has(value)) return;
    seen.add(value);

    let expanded = false;
    const nestedArrays = [value.sourceData, value.stories];
    if (!looksLikeStory(value)) nestedArrays.push(value.items);
    if (isPlainObject(value.data)) {
      nestedArrays.push(value.data.sourceData, value.data.stories, value.data.items);
    }
    if (isPlainObject(value.hackernews?.data)) {
      nestedArrays.push(value.hackernews.data.stories, value.hackernews.data.items);
    }

    for (const list of nestedArrays) {
      if (Array.isArray(list)) {
        expanded = true;
        visit(list);
      }
    }

    if (isPlainObject(value.story)) {
      expanded = true;
      visit(value.story);
    }
    if (isPlainObject(value.data?.story)) {
      expanded = true;
      visit(value.data.story);
    }

    if (!expanded && isPlainObject(value.data) && looksLikeStory(value.data)) {
      out.push(value.data);
      return;
    }

    if (!expanded) out.push(value);
  };

  visit(input);
  return out;
}

function looksLikeStory(value) {
  if (!isPlainObject(value)) return false;
  const title = stringValue(value.title || value.name || value.headline);
  if (!title) return false;
  return Boolean(value.id || value.url || value.href || value.link || value.score || value.commentCount);
}

async function fetchHackerNewsSource(source) {
  ensureFetch();
  const apiBaseUrl = normalizeBaseUrl(
    source.apiBaseUrl || source.api_base_url || source.baseUrl || 'https://hacker-news.firebaseio.com/v0'
  );
  const storyTypes = normalizeStringArray(source.storyTypes || source.story_types || source.storyType || 'top');
  const limit = boundedInt(source.limit, 30, 1, 100);
  const includeComments = Boolean(source.includeComments || source.include_comments || false);
  const commentLimit = boundedInt(source.commentLimit ?? source.comment_limit, 5, 0, 100);
  const commentDepth = boundedInt(source.commentDepth ?? source.comment_depth, 1, 0, 10);
  const timeoutMs = boundedInt(source.timeoutMs ?? source.timeout_ms, 20000, 1000, 120000);
  const retries = boundedInt(source.retries ?? source.retry_count ?? source.retryCount, 3, 0, 6);
  const stories = [];

  for (const storyType of storyTypes) {
    const normalizedType = normalizeStoryType(storyType);
    const ids = await requestJson(`${apiBaseUrl}/${normalizedType}stories.json`, timeoutMs, retries);
    if (!Array.isArray(ids)) {
      throw new Error(`Unexpected Hacker News ${normalizedType} story list response`);
    }

    const storyItems = await mapWithConcurrency(ids.slice(0, limit), 6, async id => {
      const raw = await requestJson(`${apiBaseUrl}/item/${encodeURIComponent(String(id))}.json`, timeoutMs, retries);
      if (!raw || raw.type !== 'story') return null;
      if (includeComments && commentLimit > 0 && commentDepth > 0 && Array.isArray(raw.kids)) {
        raw.comments = await fetchHackerNewsComments(raw.kids, {
          apiBaseUrl,
          commentLimit,
          commentDepth,
          timeoutMs,
          retries
        });
      }
      return normalizeStory(raw, 'hackernews', normalizedType);
    });

    for (const normalized of storyItems) {
      if (normalized) stories.push(normalized);
    }
  }

  return stories;
}

async function fetchHackerNewsComments(ids, config, depth = config.commentDepth) {
  if (!Array.isArray(ids) || depth <= 0 || config.commentLimit <= 0) return [];
  const comments = await mapWithConcurrency(ids.slice(0, config.commentLimit), 4, async id => {
    const raw = await requestJson(
      `${config.apiBaseUrl}/item/${encodeURIComponent(String(id))}.json`,
      config.timeoutMs,
      config.retries
    );
    if (!raw || raw.type !== 'comment') return null;
    const comment = {
      id: raw.id,
      author: raw.by || null,
      time: raw.time ? new Date(raw.time * 1000).toISOString() : null,
      text: cleanText(raw.text || ''),
      parent: raw.parent || null,
      deleted: Boolean(raw.deleted)
    };
    if (depth > 1 && Array.isArray(raw.kids)) {
      comment.children = await fetchHackerNewsComments(raw.kids, config, depth - 1);
    }
    return comment;
  });
  return comments.filter(Boolean);
}

function normalizeStory(raw, source, storyType = null) {
  if (!raw || typeof raw !== 'object') return null;
  const title = stringValue(raw.title || raw.name || raw.headline);
  if (!title) return null;

  const sourceId = raw.id ?? raw.objectID ?? raw.story_id ?? raw.sourceId ?? raw.source_id ?? null;
  const url = stringValue(raw.url || raw.href || raw.link);
  const time = normalizeTime(raw.time || raw.created_at || raw.createdAt || raw.date || raw.publishedAt);
  const commentCount = numberValue(raw.commentCount ?? raw.descendants ?? raw.comments_count ?? 0, 0);
  const comments = normalizeComments(raw.comments);
  const text = cleanText(raw.text || raw.summary || raw.description || '');
  const domain = url ? domainFromUrl(url) : null;
  const normalizedSource = stringValue(raw.source || source || 'input').toLowerCase();
  const key = buildStoryKey(normalizedSource, sourceId, url, title);

  return {
    key,
    id: sourceId,
    source: normalizedSource,
    storyType: storyType || raw.storyType || raw.story_type || null,
    title,
    url: url || null,
    domain,
    author: raw.author || raw.by || null,
    score: numberValue(raw.score, 0),
    time,
    commentCount,
    text,
    comments,
    articleText: cleanText(raw.articleText || raw.article_text || ''),
    raw: raw.original || null
  };
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .map(comment => ({
      id: comment?.id || null,
      author: comment?.author || comment?.by || null,
      time: normalizeTime(comment?.time),
      text: cleanText(comment?.text || ''),
      children: normalizeComments(comment?.children || [])
    }))
    .filter(comment => comment.text);
}

function selectStories(stories, config) {
  const cutoff =
    config.selection.newerThanHours === null
      ? null
      : Date.now() - config.selection.newerThanHours * 60 * 60 * 1000;
  const seenKeys = buildSeenKeySet(config.dedupe);
  const selected = [];

  for (const story of stories) {
    if (config.dedupe.enabled && seenKeys.has(story.key)) continue;
    if (config.selection.minScore !== null && story.score < config.selection.minScore) continue;
    if (config.selection.minComments !== null && story.commentCount < config.selection.minComments) continue;
    if (cutoff && story.time && new Date(story.time).getTime() < cutoff) continue;
    if (config.selection.keywords.length && !matchesKeywords(story, config.selection.keywords)) continue;
    if (config.selection.excludeKeywords.length && matchesKeywords(story, config.selection.excludeKeywords)) continue;
    if (config.selection.domains.length && !matchesDomains(story, config.selection.domains)) continue;
    if (matchesDomains(story, config.selection.excludeDomains)) continue;
    selected.push(story);
  }

  selected.sort((a, b) => scoreForSort(b, config.selection.sortBy) - scoreForSort(a, config.selection.sortBy));
  return selected.slice(0, config.selection.maxItems);
}

async function enrichStories(stories, config) {
  if (!config.enrichment.fetchArticleText || config.enrichment.maxArticles <= 0) {
    return stories;
  }

  const enriched = [];
  let fetched = 0;
  for (const story of stories) {
    const copy = { ...story };
    if (story.url && fetched < config.enrichment.maxArticles) {
      try {
        copy.articleText = await fetchArticleText(story.url, config.enrichment);
        fetched += 1;
      } catch (error) {
        copy.articleError = error.message || String(error);
      }
    }
    enriched.push(copy);
  }
  return enriched;
}

async function generateBriefing(stories, config) {
  if (!stories.length) {
    return emptyBriefing(config);
  }

  if (!config.ai.enabled) {
    return extractiveBriefing(stories, config);
  }

  if (!config.ai.apiKey) {
    throw new Error(
      'AI API key is required. Provide options.apiKey, options.ai.apiKey, context.secrets.INTELLIGENCE_API_KEY, context.secrets.DEXPS_API_KEY, or context.secrets.OPENAI_API_KEY'
    );
  }

  const aiResult = await requestOpenAiCompatible(stories, config);
  const briefing = normalizeAiBriefing(aiResult, stories, config);
  if (!briefing.provider.parsed || !stringValue(briefing.message)) {
    throw new Error('AI provider returned a briefing that could not be published');
  }
  return briefing;
}

async function requestOpenAiCompatible(stories, config) {
  ensureFetch();
  const endpoint = config.ai.endpoint || `${config.ai.baseUrl}/chat/completions`;
  const messages = buildAnalysisMessages(stories, config);
  const body = {
    model: config.ai.model,
    messages,
    temperature: config.ai.temperature,
    max_tokens: config.ai.maxTokens
  };
  if (config.ai.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    return await postChatCompletion(endpoint, body, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!config.ai.jsonMode || !/response_format|json_object|invalid_request/i.test(message)) {
      throw error;
    }
    delete body.response_format;
    return await postChatCompletion(endpoint, body, config);
  }
}

async function postChatCompletion(endpoint, body, config) {
  const response = await requestWithRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`
      },
      body: JSON.stringify(body)
    },
    config.ai.timeoutMs,
    config.ai.retries
  );

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`AI provider returned non-JSON response: ${truncate(text, 500)}`);
  }

  if (!response.ok) {
    const host = requestHost(endpoint);
    const message =
      parsed?.error?.message ||
      parsed?.message ||
      (typeof parsed?.error === 'string' ? parsed.error : '') ||
      truncate(text, 180) ||
      response.statusText;
    throw new Error(`AI provider ${host} returned HTTP ${response.status}: ${message}`);
  }

  const content = parsed?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('AI provider response did not include choices[0].message.content');
  }

  return {
    content,
    usage: parsed.usage || null,
    model: parsed.model || config.ai.model
  };
}

function buildAnalysisMessages(stories, config) {
  const profileGuide = profileInstruction(config.analysis.profile);
  const sourcePayload = stories.map(story => ({
    id: story.key,
    title: story.title,
    url: story.url,
    source: story.source,
    score: story.score,
    commentCount: story.commentCount,
    time: story.time,
    text: truncate(story.text, 500),
    articleText: truncate(story.articleText, 800),
    comments: flattenComments(story.comments).slice(0, 3).map(comment => truncate(comment.text, 240))
  }));

  const isDaily = config.output.product === 'hacker_news_daily';
  const system = [
    isDaily
      ? 'You are a news editor writing the official Hacker News Daily for readers.'
      : 'You generate concise intelligence briefings from public information.',
    'Return JSON only. Do not include markdown fences.',
    'Do not fabricate facts. Mark uncertain conclusions as uncertain.',
    'Forecasts must be framed as scenarios, not guarantees.',
    'Investment, trading, legal, and policy statements must be informational, not advice.',
    isDaily
      ? 'The message field is the published newspaper article. Write formal news prose in the target language. Do not mention AI, models, analysis availability, signal strength, status, or generation time. Do not use template labels such as 分析, 影响, 预测, 信号强度, Signal, Analysis, or Watchlist. Do not open with 今日的主要信号, 观察, or 要点. Each story must include its source URL as 来源：URL or Source: URL. Start with the dated title, then a short lede, then numbered stories.'
      : 'The message field is the published channel version in the target language.'
  ].join(' ');

  const user = {
    task: isDaily ? 'Create the official Hacker News Daily' : 'Create an intelligence briefing',
    target_language: config.analysis.targetLanguage,
    profile: config.analysis.profile,
    depth: config.analysis.depth,
    audience: config.analysis.audience,
    focus: config.analysis.focus,
    product: config.output.product,
    title_hint: defaultTitle(config),
    profile_guidance: profileGuide,
    custom_instructions: config.analysis.customInstructions,
    required_json_shape: {
      title: 'string',
      summary: 'string',
      items: [
        {
          id: 'input item id',
          title: 'string',
          signal: 'low|medium|high',
          analysis: 'string',
          impact: 'string',
          forecast: 'string',
          risks: ['string'],
          watchlist: ['string']
        }
      ],
      message: isDaily
        ? 'published daily article in target language, with a dated title, a short lead, numbered stories, and a source URL for every story'
        : 'official published channel message in target language'
    },
    stories: sourcePayload
  };

  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(user) }
  ];
}

function normalizeAiBriefing(aiResult, stories, config) {
  const parsed = parseJsonObject(aiResult.content);
  if (!parsed) {
    return {
      title: defaultTitle(config),
      profile: config.analysis.profile,
      language: config.analysis.targetLanguage,
      summary: '',
      items: [],
      message: '',
      provider: {
        model: aiResult.model,
        usage: aiResult.usage,
        parsed: false
      }
    };
  }

  const storyMap = new Map(stories.map(story => [story.key, story]));
  const items = Array.isArray(parsed.items)
    ? parsed.items.map((item, index) => {
        const id = stringValue(item.id || stories[index]?.key);
        const story = storyMap.get(id) || stories[index] || {};
        return {
          id: id || story.key || String(index),
          title: stringValue(item.title || story.title),
          url: story.url || null,
          source: story.source || null,
          signal: normalizeSignal(item.signal),
          analysis: stringValue(item.analysis),
          impact: stringValue(item.impact),
          forecast: stringValue(item.forecast || item.prediction),
          risks: normalizeStringArray(item.risks),
          watchlist: normalizeStringArray(item.watchlist)
        };
      })
    : [];

  return {
    title: stringValue(parsed.title) || defaultTitle(config),
    profile: config.analysis.profile,
    language: config.analysis.targetLanguage,
    summary: stringValue(parsed.summary) || '',
    items,
    message: stringValue(parsed.message || ''),
    provider: {
      model: aiResult.model,
      usage: aiResult.usage,
      parsed: true
    }
  };
}

function extractiveBriefing(stories, config) {
  const labels = labelsFor(config.analysis.targetLanguage);
  const items = stories.map(story => ({
    id: story.key,
    title: story.title,
    url: story.url,
    source: story.source,
    signal: signalFor(story),
    analysis: `${labels.score}: ${story.score}; ${labels.comments}: ${story.commentCount}. ${truncate(
      story.text || story.articleText || '',
      240
    )}`.trim(),
    impact: '',
    forecast: '',
    risks: [],
    watchlist: story.domain ? [story.domain] : []
  }));

  return {
    title: defaultTitle(config),
    profile: config.analysis.profile,
    language: config.analysis.targetLanguage,
    summary: `${labels.selected} ${stories.length} ${labels.items}.`,
    items,
    message: '',
    provider: {
      model: null,
      usage: null,
      parsed: true
    }
  };
}

function emptyBriefing(config) {
  const labels = labelsFor(config.analysis.targetLanguage);
  return {
    title: defaultTitle(config),
    profile: config.analysis.profile,
    language: config.analysis.targetLanguage,
    summary: labels.noItems,
    items: [],
    message: labels.noItems,
    provider: {
      model: null,
      usage: null,
      parsed: true
    }
  };
}

function finalizePublishedMessage(briefing, stories, config) {
  let message = stripPublicationNoise(stringValue(briefing.message));
  if (!message || looksLikeTemplateCopy(message) || config.output.product === 'hacker_news_daily') {
    message = composeFormalDaily(briefing, stories, config);
  }
  message = ensureSources(message, stories, config);
  return truncate(stripPublicationNoise(message), config.output.maxCharacters);
}

function stripPublicationNoise(message) {
  if (!message) return '';
  const noise = [
    /^\s*maitask intelligence briefing\s*$/i,
    /^\s*intelligence briefing\s*$/i,
    /^\s*(状态|Status)\s*[:：]/i,
    /^\s*(生成时间|Generated(?: at)?)\s*[:：]/i,
    /^\s*(信号强度|Signal(?: strength)?)\s*[:：]/i,
    /^\s*(分析|影响|预测|观察|要点|Watchlist|Analysis|Impact|Forecast)\s*[:：]/i,
    /信号强度/,
    /今日的主要信号/,
    /需要\s*AI\s*分析/,
    /AI 分析暂不可用/,
    /as an AI\b/i
  ];
  return message
    .split('\n')
    .filter(line => !noise.some(pattern => pattern.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeTemplateCopy(message) {
  return [
    /需要\s*AI\s*分析/,
    /AI 分析暂不可用/,
    /as an AI\b/i,
    /信号强度/,
    /今日的主要信号/,
    /^\s*(状态|Status|生成时间|Generated(?: at)?)\s*[:：]/m,
    /^\s*(分析|影响|预测|观察|要点|Watchlist|Signal|Analysis|Impact|Forecast)\s*[:：]/m
  ].some(pattern => pattern.test(message));
}

function publishedProse(text) {
  return stringValue(text)
    .replace(/^(分析|影响|预测|观察|要点|Watchlist|Signal(?: strength)?|Analysis|Impact|Forecast)\s*[:：]\s*/i, '')
    .replace(/信号强度\s*[:：]\s*\S+/g, '')
    .replace(/今日的主要信号是\s*[:：]?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function publishedTitle(briefing, config) {
  const title = publishedProse(briefing.title);
  if (
    !title ||
    /maitask/i.test(title) ||
    /intelligence briefing/i.test(title) ||
    /情报简报/.test(title)
  ) {
    return defaultTitle(config);
  }
  return title;
}

function sourceMarker(config) {
  const labels = labelsFor(config.analysis.targetLanguage);
  const lang = stringValue(config.analysis.targetLanguage).toLowerCase();
  return lang === 'zh' || lang.startsWith('zh-') ? `${labels.source}：` : `${labels.source}: `;
}

function composeFormalDaily(briefing, stories, config) {
  const lines = [publishedTitle(briefing, config)];
  const summary = publishedProse(briefing.summary);
  if (summary) {
    lines.push('', summary);
  }

  const items = briefing.items || [];
  stories.forEach((story, index) => {
    const insight = items.find(item => item.id === story.key) || items[index] || {};
    const title = publishedProse(insight.title || story.title);
    const body = publishedProse(
      [insight.analysis, insight.impact].map(stringValue).filter(Boolean).join(' ')
    );
    lines.push('');
    lines.push(`${index + 1}. ${title}`);
    if (body) {
      lines.push(body);
    } else if (story.text) {
      lines.push(truncate(story.text, 180));
    }
    if (config.output.includeSources && story.url) {
      lines.push(`${sourceMarker(config)}${story.url}`);
    }
  });

  return lines.join('\n').trim();
}

function ensureSources(message, stories, config) {
  if (!config.output.includeSources) return message;
  const withUrl = stories.filter(story => story.url);
  if (!withUrl.length) return message;
  if (withUrl.every(story => message.includes(story.url))) return message;

  const labels = labelsFor(config.analysis.targetLanguage);
  const marker = sourceMarker(config);
  const block = withUrl
    .map((story, index) => `${index + 1}. ${story.title}\n${marker}${story.url}`)
    .join('\n');
  return `${message.trim()}\n\n${labels.sources}\n${block}`;
}

function buildOutputItems(stories, briefing, citations) {
  const byId = new Map((briefing.items || []).map(item => [item.id, item]));
  const citationByStory = new Map(citations.map(citation => [citation.storyKey, citation.id]));

  return stories.map((story, index) => {
    const insight = byId.get(story.key) || (briefing.items || [])[index] || null;
    const citationId = citationByStory.get(story.key);
    return {
      index,
      id: story.key,
      data: {
        story: publicStory(story),
        insight
      },
      metadata: {
        source: story.source,
        score: story.score,
        commentCount: story.commentCount,
        signal: insight?.signal || signalFor(story)
      },
      citation_ids: citationId ? [citationId] : []
    };
  });
}

function publicStory(story) {
  return {
    id: story.id,
    key: story.key,
    source: story.source,
    storyType: story.storyType,
    title: story.title,
    url: story.url,
    domain: story.domain,
    author: story.author,
    score: story.score,
    time: story.time,
    commentCount: story.commentCount,
    text: story.text,
    articleText: story.articleText ? truncate(story.articleText, 2000) : ''
  };
}

function buildCitations(stories) {
  return stories.map((story, index) => ({
    id: `source-${index + 1}`,
    storyKey: story.key,
    title: story.title,
    url: story.url,
    source: story.source,
    retrieved_at: new Date().toISOString()
  }));
}

function buildNextDedupeState(config, stories) {
  const now = new Date().toISOString();
  const retained = retainSeenEntries(config.dedupe);
  const next = [...retained];
  const keys = new Set(next.map(entry => entry.key).filter(Boolean));

  for (const story of stories) {
    if (keys.has(story.key)) continue;
    keys.add(story.key);
    next.push({
      key: story.key,
      source: story.source,
      id: story.id,
      url: story.url,
      title: story.title,
      seenAt: now
    });
  }

  return {
    generatedAt: now,
    windowHours: config.dedupe.windowHours,
    seen: next.slice(-config.dedupe.maxSeen)
  };
}

function buildSeenKeySet(dedupe) {
  if (!dedupe.enabled) return new Set();
  return new Set(retainSeenEntries(dedupe).map(entry => entry.key).filter(Boolean));
}

function retainSeenEntries(dedupe) {
  const cutoff = Date.now() - dedupe.windowHours * 60 * 60 * 1000;
  return dedupe.seen.filter(entry => {
    if (!entry.key) return false;
    if (!entry.seenAt) return true;
    const ts = new Date(entry.seenAt).getTime();
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });
}

function normalizeSeenEntries(raw) {
  const list = Array.isArray(raw?.seen) ? raw.seen : Array.isArray(raw) ? raw : [];
  return list
    .map(item => {
      if (typeof item === 'string' || typeof item === 'number') {
        return { key: String(item), seenAt: null };
      }
      if (!isPlainObject(item)) return null;
      const source = stringValue(item.source || 'hackernews').toLowerCase();
      const key = item.key || buildStoryKey(source, item.id, item.url, item.title);
      return {
        key,
        source,
        id: item.id ?? null,
        url: item.url || null,
        title: item.title || null,
        seenAt: item.seenAt || item.seen_at || null
      };
    })
    .filter(Boolean);
}

async function fetchArticleText(url, config) {
  ensureFetch();
  const response = await requestWithRetry(
    url,
    { method: 'GET', headers: { Accept: 'text/html,text/plain' } },
    config.timeoutMs,
    config.retries
  );
  if (!response.ok) {
    throw new Error(`Article fetch failed with status ${response.status}`);
  }
  const body = await response.text();
  return truncate(cleanText(stripScriptsAndStyles(body)), config.maxArticleChars);
}

async function requestJson(url, timeoutMs, retries = 3) {
  const response = await requestWithRetry(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
    retries
  );
  if (!response.ok) {
    let detail = '';
    try {
      detail = truncate(await response.text(), 500);
    } catch {
      detail = response.statusText || '';
    }
    throw new Error(`Request to ${url} failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return await response.json();
}

async function requestWithRetry(url, init, timeoutMs, retries) {
  let attempt = 0;
  const maxRetries = Math.max(0, Number.parseInt(retries, 10) || 0);
  while (true) {
    let retryAfterMs = null;
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      if (response.ok || !isRetryStatus(response.status) || attempt >= maxRetries) {
        return response;
      }
      retryAfterMs = readRetryAfter(response.headers);
    } catch (error) {
      const classified = classifyFetchError(url, timeoutMs, error);
      if (!classified.retryable || attempt >= maxRetries) {
        throw decorateAttemptError(classified, attempt, maxRetries);
      }
    }
    if (attempt >= maxRetries) {
      break;
    }
    await sleep(retryDelayMs(attempt, retryAfterMs));
    attempt += 1;
  }
  throw new Error(`Request to ${requestHost(url)} failed after ${maxRetries + 1} attempts`);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  if (usesMaitaskRuntimeFetch()) {
    return await fetch(url, { ...init, timeoutMs });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, timeoutMs });
  } catch (error) {
    throw classifyFetchError(url, timeoutMs, error);
  } finally {
    clearTimeout(timer);
  }
}

function classifyFetchError(url, timeoutMs, error) {
  const message = error instanceof Error ? error.message : String(error);
  const host = requestHost(url);
  const timedOut = error?.name === 'AbortError' || /timed out/i.test(message);
  const wrapped = new Error(
    timedOut
      ? `Request to ${host} timed out after ${timeoutMs}ms`
      : `Request to ${host} failed: ${message}`
  );
  wrapped.name = timedOut ? 'AbortError' : error?.name || 'Error';
  wrapped.retryable = timedOut || isRetryableNetworkMessage(message);
  wrapped.cause = error;
  return wrapped;
}

function decorateAttemptError(error, attempt, maxRetries) {
  const tries = attempt + 1;
  if (tries <= 1) {
    return error;
  }
  error.message = `${error.message} after ${tries} of ${maxRetries + 1} attempts`;
  return error;
}

function requestHost(url) {
  try {
    return new URL(String(url)).host || String(url);
  } catch {
    return String(url);
  }
}

function isRetryableNetworkMessage(message) {
  return /timed out|error sending request|could not connect|failed to fetch|network|econnreset|enotfound|temporarily unavailable/i.test(
    String(message)
  );
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function compactDefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
  );
}

function profileInstruction(profile) {
  const map = {
    business: 'Emphasize business model, competitive dynamics, customer adoption, and monetization.',
    economic: 'Emphasize macroeconomic linkages, productivity, labor, inflation, demand, and capital allocation.',
    forecast: 'Emphasize plausible scenarios, leading indicators, time horizon, uncertainty, and second-order effects.',
    technology: 'Emphasize technical novelty, architecture implications, ecosystem impact, and developer adoption.',
    market: 'Emphasize market structure, demand signals, pricing pressure, category movement, and go-to-market relevance.',
    risk: 'Emphasize operational, security, regulatory, vendor, and adoption risks.',
    policy: 'Emphasize regulatory posture, public-sector impact, compliance exposure, and institutional incentives.',
    investment: 'Emphasize sector signals, comparable companies, catalysts, and risks without giving investment advice.',
    custom: 'Use the custom instructions and focus areas as the primary analysis lens.'
  };
  return map[profile] || map.technology;
}

function normalizeProfile(value) {
  const profile = stringValue(value || 'technology').toLowerCase().replace(/_/g, '-');
  const aliases = {
    tech: 'technology',
    economy: 'economic',
    prediction: 'forecast',
    predictions: 'forecast',
    finance: 'investment'
  };
  const normalized = aliases[profile] || profile;
  const allowed = new Set([
    'business',
    'economic',
    'forecast',
    'technology',
    'market',
    'risk',
    'policy',
    'investment',
    'custom'
  ]);
  return allowed.has(normalized) ? normalized : 'custom';
}

function normalizeStoryType(value) {
  const storyType = stringValue(value || 'top').toLowerCase();
  const allowed = new Set(['top', 'new', 'best', 'ask', 'show', 'job']);
  if (!allowed.has(storyType)) {
    throw new Error(`Unsupported Hacker News story type: ${storyType}`);
  }
  return storyType;
}

function matchesKeywords(story, keywords) {
  if (!keywords.length) return true;
  const haystack = [
    story.title,
    story.url,
    story.domain,
    story.text,
    story.articleText,
    ...flattenComments(story.comments).map(comment => comment.text)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some(keyword => haystack.includes(keyword.toLowerCase()));
}

function matchesDomains(story, domains) {
  if (!domains.length) return false;
  if (!story.domain) return false;
  return domains.some(domain => story.domain === domain || story.domain.endsWith(`.${domain}`));
}

function scoreForSort(story, sortBy) {
  if (sortBy === 'score') return story.score;
  if (sortBy === 'comments') return story.commentCount;
  if (sortBy === 'recent') return story.time ? new Date(story.time).getTime() / 100000000 : 0;
  const ageHours = story.time ? Math.max(0, (Date.now() - new Date(story.time).getTime()) / 3600000) : 48;
  const recency = Math.max(0, 48 - Math.min(ageHours, 48));
  return story.score + story.commentCount * 2 + recency;
}

function signalFor(story) {
  const signal = story.score + story.commentCount * 2;
  if (signal >= 300) return 'high';
  if (signal >= 80) return 'medium';
  return 'low';
}

function normalizeSignal(value) {
  const signal = stringValue(value || '').toLowerCase();
  if (['low', 'medium', 'high'].includes(signal)) return signal;
  return 'medium';
}

function defaultTitle(config) {
  const labels = labelsFor(config.analysis.targetLanguage);
  if (config.output.product === 'hacker_news_daily') {
    return `${labels.dailyTitle} · ${formatUtcDate()}`;
  }
  return `${labels.title}: ${config.analysis.profile}`;
}

function formatUtcDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function normalizeProduct(value) {
  const product = stringValue(value).toLowerCase().replace(/[-\s]+/g, '_');
  if (['hacker_news_daily', 'hn_daily', 'daily'].includes(product)) {
    return 'hacker_news_daily';
  }
  if (['intelligence_briefing', 'briefing'].includes(product)) {
    return 'intelligence_briefing';
  }
  return product;
}

function labelsFor(language) {
  const lang = stringValue(language).toLowerCase();
  if (lang === 'zh' || lang.startsWith('zh-')) {
    return {
      title: '情报简报',
      dailyTitle: 'Hacker News 日报',
      selected: '已选择',
      items: '条内容',
      noItems: '没有符合条件的内容。',
      score: '分数',
      comments: '评论',
      source: '来源',
      sources: '来源',
      signal: '信号',
      analysis: '分析',
      impact: '影响',
      forecast: '预测'
    };
  }
  return {
    title: 'Intelligence Briefing',
    dailyTitle: 'Hacker News Daily',
    selected: 'Selected',
    items: 'items',
    noItems: 'No qualifying items were found.',
    score: 'Score',
    comments: 'Comments',
    source: 'Source',
    sources: 'Sources',
    signal: 'Signal',
    analysis: 'Analysis',
    impact: 'Impact',
    forecast: 'Forecast'
  };
}

function buildFailure(error, startedAt, context) {
  return {
    success: false,
    data: {
      items: [],
      summary: {
        total: 0,
        success_count: 0,
        failure_count: 1
      }
    },
    error: {
      message: error?.message || 'Intelligence briefing failed',
      code: 'INTELLIGENCE_BRIEFING_ERROR',
      type: error?.name || 'IntelligenceBriefingError'
    },
    metadata: {
      contract_version: CONTRACT_VERSION,
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      execution_id: context?.execution_id || null,
      execution_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    },
    citations: []
  };
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('fetch API is required for intelligence briefing network requests');
  }
}

function mergeObjects(base, override) {
  return { ...(isPlainObject(base) ? base : {}), ...(isPlainObject(override) ? override : {}) };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberValue(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function boundedInt(value, fallback, min, max) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeStringArray(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value.map(item => stringValue(item)).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  const raw = stringValue(value);
  return raw.replace(/\/+$/, '');
}

function normalizeTime(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    const ms = value > 100000000000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(value).trim().match(/^\d+$/)) {
    return normalizeTime(asNumber);
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function buildStoryKey(source, id, url, title) {
  if (id !== null && id !== undefined && id !== '') return `${source}:${String(id)}`;
  if (url) return `${source}:url:${String(url).toLowerCase()}`;
  return `${source}:title:${stringValue(title).toLowerCase()}`;
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function flattenComments(comments) {
  const out = [];
  const visit = list => {
    for (const comment of Array.isArray(list) ? list : []) {
      out.push(comment);
      visit(comment.children);
    }
  };
  visit(comments);
  return out;
}

function cleanText(value) {
  return decodeEntities(stripTags(String(value || '')))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function stripScriptsAndStyles(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return isPlainObject(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function truncate(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function isRetryStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function readRetryAfter(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = new Date(raw).getTime();
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function retryDelayMs(attempt, retryAfterMs) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs !== null) {
    return Math.min(30000, Math.max(250, retryAfterMs));
  }
  return Math.min(30000, 500 * Math.pow(2, attempt));
}

function usesMaitaskRuntimeFetch() {
  return Boolean(
    typeof Deno !== 'undefined' &&
      Deno &&
      Deno.core &&
      Deno.core.ops &&
      typeof Deno.core.ops.op_http_request === 'function'
  );
}

async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(limit || 1, list.length || 1));
  const results = new Array(list.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(list[index], index);
    }
  }

  const workers = [];
  for (let index = 0; index < concurrency; index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

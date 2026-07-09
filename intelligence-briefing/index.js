/**
 * @maitask/intelligence-briefing
 * Multi-source intelligence briefing generator with OpenAI-compatible analysis.
 *
 * The package is intentionally channel-neutral. It produces structured briefing
 * data and a bot-ready message; Plane output adapters deliver the result to
 * Telegram, DingTalk, Feishu, Discord, Slack, or other destinations.
 */

const PACKAGE_NAME = '@maitask/intelligence-briefing';
const PACKAGE_VERSION = '0.1.0';
const CONTRACT_VERSION = '2026-06-27';

async function execute(input = {}, options = {}, context = {}) {
  const startedAt = Date.now();

  try {
    const config = buildConfig(input, options, context);
    const collection = await collectStories(input, config);
    const selected = selectStories(collection.stories, config);
    const enriched = await enrichStories(selected, config);
    const briefing = await generateBriefing(enriched, config);
    const message = buildChannelMessage(briefing, config);
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
    mergeObjects(analysisInput.ai || {}, {
      apiKey: opts.apiKey || opts.api_key || root.apiKey || root.api_key,
      baseUrl: opts.baseUrl || opts.base_url || root.baseUrl || root.base_url,
      model: opts.model || root.model
    })
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
      timeoutMs: boundedInt(enrichmentInput.timeoutMs ?? enrichmentInput.timeout_ms, 15000, 1000, 120000)
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
      timeoutMs: boundedInt(aiInput.timeoutMs ?? aiInput.timeout_ms, 60000, 1000, 300000),
      retries: boundedInt(aiInput.retries, 2, 0, 5),
      jsonMode: aiInput.jsonMode !== false && aiInput.json_mode !== false
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
  const candidates = [];
  if (Array.isArray(input)) candidates.push(input);
  if (Array.isArray(input?.sourceData)) candidates.push(input.sourceData);
  if (Array.isArray(input?.stories)) candidates.push(input.stories);
  if (Array.isArray(input?.items)) candidates.push(input.items);
  if (Array.isArray(input?.data?.stories)) candidates.push(input.data.stories);
  if (Array.isArray(input?.data?.items)) candidates.push(input.data.items);
  if (Array.isArray(input?.hackernews?.data?.stories)) candidates.push(input.hackernews.data.stories);

  const out = [];
  for (const list of candidates) {
    for (const item of list) {
      if (isPlainObject(item) && item.data && isPlainObject(item.data)) {
        out.push(item.data);
      } else {
        out.push(item);
      }
    }
  }
  return out;
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
  const stories = [];

  for (const storyType of storyTypes) {
    const normalizedType = normalizeStoryType(storyType);
    const ids = await requestJson(`${apiBaseUrl}/${normalizedType}stories.json`, timeoutMs);
    if (!Array.isArray(ids)) {
      throw new Error(`Unexpected Hacker News ${normalizedType} story list response`);
    }

    const storyItems = await mapWithConcurrency(ids.slice(0, limit), 6, async id => {
      const raw = await requestJson(`${apiBaseUrl}/item/${encodeURIComponent(String(id))}.json`, timeoutMs);
      if (!raw || raw.type !== 'story') return null;
      if (includeComments && commentLimit > 0 && commentDepth > 0 && Array.isArray(raw.kids)) {
        raw.comments = await fetchHackerNewsComments(raw.kids, {
          apiBaseUrl,
          commentLimit,
          commentDepth,
          timeoutMs
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
    const raw = await requestJson(`${config.apiBaseUrl}/item/${encodeURIComponent(String(id))}.json`, config.timeoutMs);
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
  return normalizeAiBriefing(aiResult, stories, config);
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
    const message = parsed?.error?.message || parsed?.message || text || response.statusText;
    throw new Error(`AI provider request failed with status ${response.status}: ${message}`);
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
    text: truncate(story.text, 1200),
    articleText: truncate(story.articleText, 2500),
    comments: flattenComments(story.comments).slice(0, 8).map(comment => truncate(comment.text, 500))
  }));

  const system = [
    'You generate concise intelligence briefings from public information.',
    'Return JSON only. Do not include markdown fences.',
    'Do not fabricate facts. Mark uncertain conclusions as uncertain.',
    'Forecasts must be framed as scenarios, not guarantees.',
    'Investment, trading, legal, and policy statements must be informational, not advice.'
  ].join(' ');

  const user = {
    task: 'Create an intelligence briefing',
    target_language: config.analysis.targetLanguage,
    profile: config.analysis.profile,
    depth: config.analysis.depth,
    audience: config.analysis.audience,
    focus: config.analysis.focus,
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
      message: 'bot-ready concise message in target language'
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
    const fallback = extractiveBriefing(stories, config);
    return {
      ...fallback,
      summary: truncate(aiResult.content, 1200),
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
    impact: labels.extractiveImpact,
    forecast: labels.extractiveForecast,
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

function buildChannelMessage(briefing, config) {
  if (briefing.message) {
    return truncate(briefing.message, config.output.maxCharacters);
  }

  const labels = labelsFor(config.analysis.targetLanguage);
  const lines = [briefing.title, '', briefing.summary].filter(Boolean);
  briefing.items.forEach((item, index) => {
    lines.push('');
    lines.push(`${index + 1}. ${item.title}`);
    if (item.signal) lines.push(`${labels.signal}: ${item.signal}`);
    if (item.analysis) lines.push(`${labels.analysis}: ${item.analysis}`);
    if (item.impact) lines.push(`${labels.impact}: ${item.impact}`);
    if (item.forecast) lines.push(`${labels.forecast}: ${item.forecast}`);
    if (item.url && config.output.includeSources) lines.push(item.url);
  });

  return truncate(lines.join('\n'), config.output.maxCharacters);
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
  const response = await fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'text/html,text/plain' } }, config.timeoutMs);
  if (!response.ok) {
    throw new Error(`Article fetch failed with status ${response.status}`);
  }
  const body = await response.text();
  return truncate(cleanText(stripScriptsAndStyles(body)), config.maxArticleChars);
}

async function requestJson(url, timeoutMs) {
  const response = await fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }
  return await response.json();
}

async function requestWithRetry(url, init, timeoutMs, retries) {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      if (response.ok || !isRetryStatus(response.status) || attempt >= retries) {
        return response;
      }
    } catch (error) {
      if (attempt >= retries) throw error;
    }
    await sleep(500 * Math.pow(2, attempt));
    attempt += 1;
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  if (usesMaitaskRuntimeFetch()) {
    return await fetch(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  return `${labels.title}: ${config.analysis.profile}`;
}

function labelsFor(language) {
  const lang = stringValue(language).toLowerCase();
  if (lang === 'zh' || lang.startsWith('zh-')) {
    return {
      title: '情报简报',
      selected: '已选择',
      items: '条内容',
      noItems: '没有符合条件的内容。',
      score: '分数',
      comments: '评论',
      signal: '信号',
      analysis: '分析',
      impact: '影响',
      forecast: '预测',
      extractiveImpact: '需要 AI 分析或人工复核以形成影响判断。',
      extractiveForecast: '需要 AI 分析或人工复核以形成情景预测。'
    };
  }
  return {
    title: 'Intelligence Briefing',
    selected: 'Selected',
    items: 'items',
    noItems: 'No qualifying items were found.',
    score: 'Score',
    comments: 'Comments',
    signal: 'Signal',
    analysis: 'Analysis',
    impact: 'Impact',
    forecast: 'Forecast',
    extractiveImpact: 'AI analysis or human review is required for impact judgment.',
    extractiveForecast: 'AI analysis or human review is required for scenario forecasting.'
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

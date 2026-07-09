export interface MaitaskPackageContext {
  secrets?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  defaults?: Record<string, unknown>;
  workspace_path?: string;
  execution_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export type IntelligenceSourceType = 'hackernews' | 'items' | 'inline';

export interface IntelligenceSource {
  type?: IntelligenceSourceType | 'hn';
  storyType?: 'top' | 'new' | 'best' | 'ask' | 'show' | 'job';
  storyTypes?: Array<'top' | 'new' | 'best' | 'ask' | 'show' | 'job'>;
  limit?: number;
  includeComments?: boolean;
  commentLimit?: number;
  commentDepth?: number;
  apiBaseUrl?: string;
  baseUrl?: string;
  timeoutMs?: number;
  timeout_ms?: number;
  retries?: number;
  retry_count?: number;
  retryCount?: number;
  items?: unknown[];
  [key: string]: unknown;
}

export type AnalysisProfile =
  | 'business'
  | 'economic'
  | 'forecast'
  | 'technology'
  | 'market'
  | 'risk'
  | 'policy'
  | 'investment'
  | 'custom';

export interface BriefingAnalysisConfig {
  profile?: AnalysisProfile | string;
  targetLanguage?: string;
  target_language?: string;
  depth?: 'brief' | 'standard' | 'deep' | string;
  focus?: string[] | string;
  customInstructions?: string;
  custom_instructions?: string;
  audience?: string;
  ai?: BriefingAiConfig;
}

export interface BriefingAiConfig {
  enabled?: boolean;
  provider?: 'openai_compatible' | 'extractive' | 'none' | 'disabled' | string;
  apiKey?: string;
  api_key?: string;
  baseUrl?: string;
  base_url?: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
  timeoutMs?: number;
  timeout_ms?: number;
  retries?: number;
  jsonMode?: boolean;
  json_mode?: boolean;
}

export interface BriefingSelectionConfig {
  maxItems?: number;
  max_items?: number;
  minScore?: number;
  min_score?: number;
  minComments?: number;
  min_comments?: number;
  newerThanHours?: number;
  newer_than_hours?: number;
  keywords?: string[] | string;
  excludeKeywords?: string[] | string;
  exclude_keywords?: string[] | string;
  domains?: string[] | string;
  excludeDomains?: string[] | string;
  exclude_domains?: string[] | string;
  sortBy?: 'signal' | 'score' | 'comments' | 'recent' | string;
  sort_by?: string;
}

export interface BriefingDedupeEntry {
  key?: string;
  source?: string;
  id?: string | number | null;
  url?: string | null;
  title?: string | null;
  seenAt?: string | null;
  seen_at?: string | null;
}

export interface BriefingDedupeConfig {
  enabled?: boolean;
  windowHours?: number;
  window_hours?: number;
  seen?: BriefingDedupeEntry[] | string[];
  maxSeen?: number;
  max_seen?: number;
}

export interface BriefingEnrichmentConfig {
  fetchArticleText?: boolean;
  fetch_article_text?: boolean;
  maxArticles?: number;
  max_articles?: number;
  maxArticleChars?: number;
  max_article_chars?: number;
  timeoutMs?: number;
  timeout_ms?: number;
  retries?: number;
  retry_count?: number;
}

export interface BriefingOutputConfig {
  format?: 'channel_message' | 'json' | string;
  maxCharacters?: number;
  max_characters?: number;
  includeSources?: boolean;
  include_sources?: boolean;
  includeMetadata?: boolean;
  include_metadata?: boolean;
}

export interface IntelligenceBriefingInput {
  sources?: IntelligenceSource[];
  source?: IntelligenceSource;
  sourceData?: unknown[];
  stories?: unknown[];
  items?: unknown[];
  analysis?: BriefingAnalysisConfig;
  selection?: BriefingSelectionConfig;
  dedupe?: BriefingDedupeConfig;
  enrichment?: BriefingEnrichmentConfig;
  output?: BriefingOutputConfig;
  ai?: BriefingAiConfig;
  apiKey?: string;
  api_key?: string;
  baseUrl?: string;
  base_url?: string;
  model?: string;
  [key: string]: unknown;
}

export interface BriefingInsight {
  id: string;
  title: string;
  url?: string | null;
  source?: string | null;
  signal: 'low' | 'medium' | 'high';
  analysis: string;
  impact: string;
  forecast: string;
  risks: string[];
  watchlist: string[];
}

export interface IntelligenceBriefingResult {
  success: boolean;
  data: {
    items: Array<{
      index: number;
      id: string;
      data: {
        story: Record<string, unknown>;
        insight: BriefingInsight | null;
      };
      metadata: Record<string, unknown>;
      citation_ids: string[];
    }>;
    summary: {
      total: number;
      success_count: number;
      failure_count: number;
      metrics?: Record<string, unknown>;
    };
    briefing?: {
      title: string;
      profile: string;
      language: string;
      summary: string;
      items: BriefingInsight[];
      message: string;
      provider?: Record<string, unknown>;
    };
    message?: string;
    nextDedupeState?: {
      generatedAt: string;
      windowHours: number;
      seen: BriefingDedupeEntry[];
    };
  };
  error: null | {
    message: string;
    code: string;
    type: string;
  };
  metadata: Record<string, unknown>;
  citations: Array<Record<string, unknown>>;
}

export function execute(
  input?: IntelligenceBriefingInput,
  options?: BriefingAiConfig & Record<string, unknown>,
  context?: MaitaskPackageContext
): Promise<IntelligenceBriefingResult>;

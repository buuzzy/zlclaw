/**
 * CodeAny Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @codeany/open-agent-sdk.
 * Runs entirely in-process — no external CLI binary required.
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';
import {
  query,
} from '@codeany/open-agent-sdk';
import type { AgentOptions as SdkAgentOptions } from '@codeany/open-agent-sdk';

import { refreshSkillsForPrompt } from '@/shared/skills/predictor';

import {
  BaseAgent,
  buildLanguageInstruction,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import { CODEANY_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  ImageAttachment,
  McpConfig,
  PlanOptions,
  SkillsConfig,
} from '@/core/agent/types';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';
import { getSageSystemPrompt } from '@/config/prompt-loader';
import { appendDailyMemory } from '@/shared/memory/daily-writer';
import { loadMcpServers, type McpServerConfig } from '@/shared/mcp/loader';
import { createLogger, LOG_FILE_PATH } from '@/shared/utils/logger';
import { stripHashSuffix } from '@/shared/utils/url';

const logger = createLogger('CodeAnyAgent');

// ============================================================================
// Deterministic Tool Output Interception
//
// Detects westock API calls from Bash command URL patterns and JSON response
// structure. No LLM cooperation required — works purely at the code layer.
//
// Detection strategy (two layers):
//   Layer 1 — URL pattern matching on the Bash command string
//   Layer 2 — JSON response structure matching on the tool output
//
// When a match is found:
//   • Full data is formatted as an artifact block and queued for the frontend
//   • A concise summary (~100-200 chars) replaces the tool output for the LLM
//   • Token savings: ~5K tokens per intercepted query
// ============================================================================

/** (skill, action) → artifact component type */
const ARTIFACT_TYPE_MAP: Record<string, Record<string, string>> = {
  'westock-quote': {
    'stock_quote_snapshot': 'quote-card',
    'stock_quote_history': 'kline-chart',
  },
  'westock-market': {
    'stock_search': 'text',
    'hot_stock': 'data-table',
    'hot_board': 'data-table',
    'ipo_calendar': 'data-table',
    'finance_calendar': 'data-table',
    'watchlist_rank': 'data-table',
  },
  'westock-research': {
    'stock_report': 'data-table',
    'research_report_curated': 'data-table',
    'announcement_list': 'data-table',
    'announcement_content': 'text',
    'market_news': 'news-list',
  },
  'westock-screener': {
    'stock_filter_query': 'data-table',
    'query_list_data_by_date': 'data-table',
  },
};

/**
 * URL path → (skill, action) mapping for GET endpoints.
 * Order matters: first match wins. Patterns are tested with String.includes().
 */
const URL_PATH_PATTERNS: Array<{ pattern: string; skill: string; action: string }> = [
  // westock-quote GET endpoints
  // westock-market GET endpoints
  { pattern: '/smartbox/search',               skill: 'westock-market',   action: 'stock_search' },
  { pattern: '/HotStock/getHotStockDetail',    skill: 'westock-market',   action: 'hot_stock' },
  { pattern: '/board/index',                   skill: 'westock-market',   action: 'hot_board' },
  { pattern: '/ipo/search',                    skill: 'westock-market',   action: 'ipo_calendar' },
  { pattern: '/FinanceCalendar/query',         skill: 'westock-market',   action: 'finance_calendar' },
  { pattern: '/watchlist/rank',                skill: 'westock-market',   action: 'watchlist_rank' },
  // westock-research GET endpoints
  { pattern: '/investRate/getReport',          skill: 'westock-research', action: 'stock_report' },
  { pattern: '/noticeList/searchByType',       skill: 'westock-research', action: 'announcement_list' },
  { pattern: '/news/content/content',          skill: 'westock-research', action: 'announcement_content' },
  { pattern: '/news/info/search',              skill: 'westock-research', action: 'market_news' },
];

/**
 * POST route names used with the proxy endpoint (/openai/openclaw/proxy).
 * Maps the `"route"` field in the request body to (skill, action).
 */
const POST_ROUTE_MAP: Record<string, { skill: string; action: string }> = {
  'stock_quote_snapshot':      { skill: 'westock-quote',    action: 'stock_quote_snapshot' },
  'stock_quote_history':       { skill: 'westock-quote',    action: 'stock_quote_history' },
  'research_report_list_get':  { skill: 'westock-research', action: 'research_report_curated' },
  'stock_filter_query':        { skill: 'westock-screener', action: 'stock_filter_query' },
  'query_list_data_by_date':   { skill: 'westock-screener', action: 'query_list_data_by_date' },
};

interface ToolOutputMetadata {
  skill: string;
  action: string;
  list_code?: string;
}

interface InterceptResult {
  metadata: ToolOutputMetadata;
  artifactBlock: string;
  summary: string;
}

// ---- Layer 1: URL / route detection from the Bash command string -----------

/**
 * Extract (skill, action) from the Bash command string by matching URL paths
 * and POST route names. Returns null if no westock API call is detected.
 */
function detectFromCommand(command: string): ToolOutputMetadata | null {
  if (!command) return null;

  // Layer 1a: Match GET endpoint URL paths
  for (const { pattern, skill, action } of URL_PATH_PATTERNS) {
    if (command.includes(pattern)) {
      return { skill, action };
    }
  }

  // Layer 1b: Match POST proxy route names
  // The command may contain the route in a JSON body, e.g.:
  //   curl ... -d '{"route":"stock_quote_snapshot", ...}'
  //   requests.post(..., json={"route": "stock_quote_snapshot", ...})
  // We use a broad regex that catches both single/double quoted JSON
  const routeMatch = command.match(/"route"\s*:\s*"([^"]+)"/);
  if (routeMatch) {
    const routeName = routeMatch[1];
    const mapping = POST_ROUTE_MAP[routeName];
    if (mapping) {
      const meta: ToolOutputMetadata = { ...mapping };

      // For screener list queries, also extract list_codes
      if (routeName === 'query_list_data_by_date') {
        const listCodeMatch = command.match(/"list_codes"\s*:\s*\[\s*"([^"]+)"/);
        if (listCodeMatch) {
          meta.list_code = listCodeMatch[1];
        }
      }
      return meta;
    }
  }

  return null;
}

// ---- Layer 2: JSON response structure detection from tool output ----------

/**
 * Detect (skill, action) from JSON response structure when Layer 1 fails.
 * This handles cases where MiniMax uses Python scripts or unconventional
 * command patterns that don't match our URL regex.
 */
function detectFromResponseStructure(parsed: any): ToolOutputMetadata | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const data = parsed.data;
  if (!data) return null;

  // stock_quote_snapshot: { data: { stocks: [{ code, name, data: { ClosePrice, ... } }] } }
  if (data.stocks && Array.isArray(data.stocks) && data.stocks.length > 0) {
    const first = data.stocks[0];
    if (first?.data?.ClosePrice !== undefined || first?.data?.LastestTradedPrice !== undefined) {
      return { skill: 'westock-quote', action: 'stock_quote_snapshot' };
    }
    // hot_stock: { data: { stocks: [{ code, name, zdf, zxj }] } }
    if (first?.zdf !== undefined || first?.zxj !== undefined) {
      return { skill: 'westock-market', action: 'hot_stock' };
    }
  }

  // stock_quote_history: { data: { code, name, series: [{ date, data: {...} }] } }
  if (data.series && Array.isArray(data.series) && data.code) {
    return { skill: 'westock-quote', action: 'stock_quote_history' };
  }

  // hot_board: { data: { rank: { plate: [...] } } }
  if (data.rank && (data.rank.plate || data.rank.concept)) {
    return { skill: 'westock-market', action: 'hot_board' };
  }

  // ipo_calendar: { data: { ipoList: [...] } }
  if (data.ipoList && Array.isArray(data.ipoList)) {
    return { skill: 'westock-market', action: 'ipo_calendar' };
  }

  // finance_calendar: { data: [{ date, list: [{ FinancialEvent, ... }] }] }
  if (Array.isArray(data) && data.length > 0 && data[0]?.list && Array.isArray(data[0].list)) {
    const item = data[0].list[0];
    if (item?.FinancialEvent !== undefined || item?.CountryName !== undefined) {
      return { skill: 'westock-market', action: 'finance_calendar' };
    }
  }

  // stock_filter_query: { data: { component_data: { total_stocks, data: { stocks: [...] } } } }
  if (data.component_data?.data?.stocks || data.component_data?.total_stocks !== undefined) {
    return { skill: 'westock-screener', action: 'stock_filter_query' };
  }

  // query_list_data_by_date: { data: { data: { <list_code>: { list_data, list_info } } } }
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const keys = Object.keys(data.data);
    const firstVal = keys.length > 0 ? data.data[keys[0]] : null;
    if (firstVal?.list_data !== undefined && firstVal?.list_info?.list_code) {
      return {
        skill: 'westock-screener',
        action: 'query_list_data_by_date',
        list_code: firstVal.list_info.list_code,
      };
    }
  }

  // market_news: { data: { total_num, data: [{ title, src, time, ... }] } }
  if (data.total_num !== undefined && Array.isArray(data.data) && data.data.length > 0) {
    const item = data.data[0];
    if (item?.title && item?.src && item?.time) {
      // Could be news or announcement_list — differentiate by field presence
      if (item?.importance !== undefined || item?.predictTimestamp !== undefined || item?.summary !== undefined) {
        return { skill: 'westock-research', action: 'market_news' };
      }
      if (item?.newstype !== undefined || item?.type !== undefined) {
        return { skill: 'westock-research', action: 'announcement_list' };
      }
      // Default to market_news for list-like responses with title+src+time
      return { skill: 'westock-research', action: 'market_news' };
    }
  }

  // stock_report: { data: { reports: [...] } }
  if (data.reports && Array.isArray(data.reports)) {
    return { skill: 'westock-research', action: 'stock_report' };
  }

  // research_report_curated: { data: { items: [{ id, title, preview, ... }] } }
  if (data.items && Array.isArray(data.items) && data.items[0]?.preview !== undefined) {
    return { skill: 'westock-research', action: 'research_report_curated' };
  }

  return null;
}

// ---- Data transformation: API response → Component data format ------------

/**
 * Transform raw API response data into the format expected by frontend components.
 *
 * Each artifact type has a specific data interface (QuoteCardData, KLineChartData, etc.)
 * that differs from the raw westock API response structure.
 * Returns null if the data cannot be transformed (caller should skip interception).
 */
function transformForComponent(artifactType: string, meta: ToolOutputMetadata, parsed: any): any {
  const data = parsed.data;
  if (!data) return null;

  try {
    switch (artifactType) {
      case 'quote-card': {
        // API: { data: { stocks: [{ code, name, data: { ClosePrice, Change, ... } }] } }
        // Component: { code, name, price, chgVal, chgPct, prevClose, open, high, low, vol, turnover, mktCap, currency, mkt }
        const stocks = data.stocks;
        if (!Array.isArray(stocks) || stocks.length === 0) return null;
        const s = stocks[0];
        const d = s.data || {};
        return {
          code: s.code || '',
          name: s.name || '',
          price: parseFloat(d.ClosePrice || d.LastestTradedPrice || '0'),
          chgVal: parseFloat(d.Change || '0'),
          chgPct: parseFloat(d.ChangeRatio || '0'),
          prevClose: parseFloat(d.PrevClosePrice || '0'),
          open: parseFloat(d.OpenPrice || '0'),
          high: parseFloat(d.HighPrice || '0'),
          low: parseFloat(d.LowPrice || '0'),
          vol: parseInt(d.TurnoverVolume || '0', 10),
          turnover: parseFloat(d.TurnoverAmount || '0'),
          mktCap: parseFloat(d.TotalMV || '0'),
          currency: 'CNY',
          mkt: s.code?.startsWith('hk') ? 'HK' : 'CN',
        };
      }

      case 'kline-chart': {
        // API: { data: { code, name, series: [{ date, data: { OpenPrice, ClosePrice, ... } }] } }
        // Component: { code, name, ktype, data: [{ time, open, close, high, low, vol }] }
        if (!data.series || !Array.isArray(data.series)) return null;
        return {
          code: data.code || '',
          name: data.name || '',
          ktype: 'day',
          data: data.series.map((point: any) => ({
            time: point.date || '',
            open: parseFloat(point.data?.OpenPrice || point.data?.FwdOpenPrice || '0'),
            close: parseFloat(point.data?.ClosePrice || point.data?.FwdClosePrice || '0'),
            high: parseFloat(point.data?.HighPrice || point.data?.FwdHighPrice || '0'),
            low: parseFloat(point.data?.LowPrice || point.data?.FwdLowPrice || '0'),
            vol: parseInt(point.data?.TurnoverVolume || '0', 10),
            turnover: parseFloat(point.data?.TurnoverAmount || '0'),
          })),
        };
      }

      case 'data-table': {
        // Various actions produce different structures. Try common patterns.
        // Component: { title, columns: [{ key, label }], rows: [{ key: value }] }

        // hot_stock: { data: { stocks: [{ code, name, zdf, zxj }] } }
        if (meta.action === 'hot_stock' && data.stocks) {
          return {
            title: '热搜股票',
            columns: [
              { key: 'code', label: '代码' },
              { key: 'name', label: '名称' },
              { key: 'zxj', label: '最新价' },
              { key: 'zdf', label: '涨跌幅' },
            ],
            rows: data.stocks.map((s: any) => ({
              code: s.code || '',
              name: s.name || '',
              zxj: s.zxj || '',
              zdf: s.zdf || '',
            })),
          };
        }

        // hot_board: { data: { rank: { plate: [...] } } }
        if (meta.action === 'hot_board' && data.rank?.plate) {
          return {
            title: '板块排行',
            columns: [
              { key: 'name', label: '板块' },
              { key: 'zdf', label: '涨跌幅' },
              { key: 'leader', label: '领涨股' },
              { key: 'leaderZdf', label: '领涨幅' },
            ],
            rows: data.rank.plate.map((b: any) => ({
              name: b.bd_name || '',
              zdf: b.bd_zdf ? `${b.bd_zdf}%` : '',
              leader: b.nzg_name || '',
              leaderZdf: b.nzg_zdf ? `${b.nzg_zdf}%` : '',
            })),
          };
        }

        // stock_filter_query: { data: { component_data: { data: { columns, stocks } } } }
        if (meta.action === 'stock_filter_query' && data.component_data) {
          const cd = data.component_data;
          const cols = cd.data?.columns || [];
          const stocks = cd.data?.stocks || [];
          return {
            title: cd.selection_desc || '筛选结果',
            columns: [
              { key: 'code', label: '代码' },
              { key: 'name', label: '名称' },
              ...cols.map((c: any, i: number) => ({ key: `col_${i}`, label: c.display_name || '' })),
            ],
            rows: stocks.map((s: any) => {
              const row: Record<string, string> = { code: s.code || '', name: s.name || '' };
              (s.condition_values || []).forEach((v: any, i: number) => {
                row[`col_${i}`] = v.disp || '';
              });
              return row;
            }),
          };
        }

        // ipo_calendar: { data: { ipoList: [...] } }
        if (meta.action === 'ipo_calendar' && data.ipoList) {
          return {
            title: '新股日历',
            columns: [
              { key: 'name', label: '名称' },
              { key: 'symbol', label: '代码' },
              { key: 'price', label: '发行价' },
              { key: 'ssrq', label: '上市日期' },
            ],
            rows: data.ipoList.map((item: any) => ({
              name: item.name || '',
              symbol: item.symbol || '',
              price: item.price || '',
              ssrq: item.ssrq || '',
            })),
          };
        }

        // stock_report: { data: { reports: [...] } }
        if (meta.action === 'stock_report' && data.reports) {
          return {
            title: '个股研报',
            columns: [
              { key: 'title', label: '标题' },
              { key: 'src', label: '机构' },
              { key: 'tzpj', label: '评级' },
              { key: 'time', label: '日期' },
            ],
            rows: data.reports.map((r: any) => ({
              title: r.title || '',
              src: r.src || '',
              tzpj: r.tzpj || '',
              time: r.time || '',
            })),
          };
        }

        // research_report_curated: { data: { items: [...] } }
        if (meta.action === 'research_report_curated' && data.items) {
          return {
            title: '精选研报',
            columns: [
              { key: 'title', label: '标题' },
              { key: 'preview', label: '摘要' },
            ],
            rows: data.items.map((item: any) => ({
              title: item.title || '',
              preview: (item.preview || '').slice(0, 100),
            })),
          };
        }

        // announcement_list: { data: { data: [...] } } or { data: { notices: [...] } }
        if (meta.action === 'announcement_list') {
          const list = data.data || data.notices || [];
          return {
            title: '公告列表',
            columns: [
              { key: 'title', label: '标题' },
              { key: 'time', label: '日期' },
            ],
            rows: (Array.isArray(list) ? list : []).map((item: any) => ({
              title: item.title || '',
              time: item.time || '',
            })),
          };
        }

        // finance_calendar: { data: [{ list: [...] }] }
        if (meta.action === 'finance_calendar' && Array.isArray(data)) {
          const items = data.flatMap((d: any) => d.list || []);
          return {
            title: '投资日历',
            columns: [
              { key: 'time', label: '时间' },
              { key: 'event', label: '事件' },
              { key: 'country', label: '国家' },
              { key: 'prev', label: '前值' },
              { key: 'predict', label: '预期' },
              { key: 'actual', label: '实际' },
            ],
            rows: items.map((item: any) => ({
              time: item.time || '',
              event: item.FinancialEvent || '',
              country: item.CountryName || '',
              prev: item.Previous || '',
              predict: item.Predict || '',
              actual: item.CurrentValue || '',
            })),
          };
        }

        // query_list_data_by_date: { data: { data: { <code>: { list_data: "json string" } } } }
        if (meta.action === 'query_list_data_by_date' && data.data) {
          const keys = Object.keys(data.data);
          if (keys.length === 0) return null;
          const firstKey = keys[0];
          const listDataStr = data.data[firstKey]?.list_data;
          if (!listDataStr) return null;
          try {
            const rows = JSON.parse(listDataStr);
            if (!Array.isArray(rows) || rows.length === 0) return null;
            const columns = Object.keys(rows[0]).map(k => ({ key: k, label: k }));
            return { title: firstKey, columns, rows };
          } catch { return null; }
        }

        // Generic fallback: pass through (may not render correctly)
        return data;
      }

      case 'news-list': {
        // market_news: { data: { total_num, data: [{ title, src, time, summary }] } }
        // Component: { items: [{ newId, title, summary, tags, publishTime }], total, hasMore }
        const newsList = data.data || [];
        if (!Array.isArray(newsList)) return null;
        return {
          items: newsList.map((item: any, i: number) => ({
            newId: item.id || `news_${i}`,
            title: item.title || '',
            summary: item.summary || '',
            tags: item.title_mention ? item.title_mention.split(',') : [],
            publishTime: item.time || '',
          })),
          total: data.total_num || newsList.length,
          hasMore: (data.total_num || 0) > newsList.length,
        };
      }

      default:
        // Unknown artifact type — pass data through as-is
        return data;
    }
  } catch (err) {
    logger.warn(`[transformForComponent] Failed to transform ${artifactType}/${meta.action}:`, err);
    return null;
  }
}

// ---- Main interception function -------------------------------------------

/**
 * Deterministic interception of Bash tool output.
 *
 * @param command  - The Bash command string (from toolInput.command)
 * @param output   - The tool output string (stdout from Bash execution)
 * @returns InterceptResult if intercepted, null otherwise (fall-through to LLM)
 */
function interceptToolOutput(command: string, output: string): InterceptResult | null {
  if (!output || output.length < 10) return null;

  // Try to parse output as JSON
  let parsed: any;
  try {
    // Handle case where output has leading/trailing whitespace or debug lines
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;
    const jsonStr = output.slice(jsonStart, jsonEnd + 1);
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  // Quick check: must look like a westock API response (has code or data field)
  if (parsed.code === undefined && !parsed.data) return null;

  // Skip error responses — only intercept successful API calls
  if (parsed.code !== undefined && parsed.code !== 0 && !parsed.data) return null;

  // Layer 1: Detect from Bash command URL/route patterns
  let meta = detectFromCommand(command);

  // Layer 2: Fallback to response structure detection
  if (!meta) {
    meta = detectFromResponseStructure(parsed);
  }

  // If _metadata is present (rare, but honor it as Layer 0)
  if (!meta && parsed._metadata?.skill && parsed._metadata?.action) {
    meta = {
      skill: parsed._metadata.skill,
      action: parsed._metadata.action,
      list_code: parsed._metadata.list_code,
    };
  }

  if (!meta) return null;

  // Look up artifact type
  const skillMap = ARTIFACT_TYPE_MAP[meta.skill];
  if (!skillMap) return null;
  const artifactType = skillMap[meta.action];
  if (!artifactType || artifactType === 'text') return null;

  // Transform API response into the format expected by frontend components.
  // Each component type has its own data interface (QuoteCardData, KLineChartData, etc.)
  // that differs from the raw API response structure.
  const componentData = transformForComponent(artifactType, meta, parsed);
  if (!componentData) return null;

  // Build the artifact block in the same format the LLM would output
  const artifactBlock = '```artifact:' + artifactType + '\n' + JSON.stringify(componentData, null, 2) + '\n```';

  // Generate a concise summary for the LLM
  const summary = generateSummary(meta, parsed);

  logger.info(`[interceptToolOutput] Intercepted ${meta.skill}/${meta.action} → ${artifactType} (summary: ${summary.length} chars, original: ${output.length} chars, detection: ${detectFromCommand(command) ? 'url' : 'structure'})`);

  return { metadata: meta, artifactBlock, summary };
}

// ---- Summary generation ---------------------------------------------------

/**
 * Generate a concise text summary from API response data.
 * This is what the LLM sees instead of the full data payload.
 */
function generateSummary(meta: ToolOutputMetadata, parsed: any): string {
  const data = parsed.data;
  try {
    if (meta.skill === 'westock-quote') {
      if (meta.action === 'stock_quote_snapshot' && data?.stocks?.length > 0) {
        const s = data.stocks[0];
        const d = s.data || {};
        return `[数据已获取] ${s.name || ''}(${s.code || ''}) 最新价${d.ClosePrice || d.LastestTradedPrice || '—'} 涨跌${d.Change || '—'}(${d.ChangeRatio || '—'}%) 昨收${d.PrevClosePrice || '—'} 开${d.OpenPrice || '—'} 高${d.HighPrice || '—'} 低${d.LowPrice || '—'}。报价卡片已自动渲染，请基于上述数据撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'stock_quote_history' && data?.series?.length > 0) {
        const series = data.series;
        const first = series[0];
        const last = series[series.length - 1];
        return `[数据已获取] ${data.name || ''}(${data.code || ''}) K线${series.length}天 ${first.date}~${last.date} 首日收${first.data?.ClosePrice || '—'} 末日收${last.data?.ClosePrice || '—'}。K线图已自动渲染，请基于上述数据撰写分析，不要输出artifact块。`;
      }
    }

    if (meta.skill === 'westock-market') {
      if (meta.action === 'hot_stock') {
        const stocks = data?.stocks || [];
        const top3 = Array.isArray(stocks) ? stocks.slice(0, 3).map((s: any) => `${s.name}(${s.zdf})`).join('、') : '';
        return `[数据已获取] 热搜股票${Array.isArray(stocks) ? stocks.length : 0}只${top3 ? '，前3：' + top3 : ''}。数据表已自动渲染，请基于数据撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'hot_board') {
        return `[数据已获取] 板块排行数据已获取。数据表已自动渲染，请基于数据撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'ipo_calendar') {
        const list = data?.ipoList || [];
        return `[数据已获取] 新股日历${Array.isArray(list) ? list.length : 0}条。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'finance_calendar') {
        return `[数据已获取] 投资日历数据已获取。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      return `[数据已获取] 市场数据已获取。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
    }

    if (meta.skill === 'westock-research') {
      if (meta.action === 'market_news') {
        const news = data?.data || [];
        const count = Array.isArray(news) ? news.length : 0;
        const top = Array.isArray(news) && news.length > 0 ? `，最新：${news[0].title?.slice(0, 30)}` : '';
        return `[数据已获取] ${count}条新闻${top}。新闻列表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'stock_report') {
        const reports = data?.reports || [];
        return `[数据已获取] ${Array.isArray(reports) ? reports.length : 0}条研报。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'research_report_curated') {
        const items = data?.items || [];
        return `[数据已获取] ${Array.isArray(items) ? items.length : 0}条精选研报。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'announcement_list') {
        const list = data?.data || [];
        return `[数据已获取] ${Array.isArray(list) ? list.length : 0}条公告。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      return `[数据已获取] 研报/公告数据已获取。组件已自动渲染，请撰写分析，不要输出artifact块。`;
    }

    if (meta.skill === 'westock-screener') {
      if (meta.action === 'stock_filter_query') {
        const total = data?.component_data?.total_stocks || 0;
        const desc = data?.component_data?.selection_desc || '';
        return `[数据已获取] 筛选结果${total}只股票${desc ? '。' + desc : ''}。数据表已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      if (meta.action === 'query_list_data_by_date') {
        const keys = data?.data ? Object.keys(data.data) : [];
        return `[数据已获取] 列表数据(${keys.join(', ')})已获取。组件已自动渲染，请撰写分析，不要输出artifact块。`;
      }
      return `[数据已获取] 列表数据已获取。组件已自动渲染，请撰写分析，不要输出artifact块。`;
    }
  } catch {
    // Fall through to generic summary
  }

  // Generic fallback
  return `[数据已获取] ${meta.skill}/${meta.action} 数据已获取。组件已自动渲染，请撰写分析，不要输出artifact块。`;
}

// Sandbox API URL
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

// ============================================================================
// Helper functions
// ============================================================================

function expandPath(inputPath: string): string {
  let result = inputPath;
  if (result.startsWith('~')) {
    result = join(homedir(), result.slice(1));
  }
  if (platform() === 'win32') {
    result = result.replace(/\//g, '\\');
  }
  return result;
}

function generateFallbackSlug(prompt: string, taskId: string): string {
  let slug = prompt
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');

  if (!slug || slug.length < 3) {
    slug = 'task';
  }

  const suffix = taskId.slice(-6);
  return `${slug}-${suffix}`;
}

function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): string {
  const expandedPath = expandPath(workDir);

  const hasSessionsPath = expandedPath.includes('/sessions/') || expandedPath.includes('\\sessions\\');
  const endsWithSessions = expandedPath.endsWith('/sessions') || expandedPath.endsWith('\\sessions');
  if (hasSessionsPath && !endsWithSessions) {
    return expandedPath;
  }

  const baseDir = expandedPath;
  const sessionsDir = join(baseDir, 'sessions');

  let folderName: string;
  if (prompt && taskId) {
    folderName = generateFallbackSlug(prompt, taskId);
  } else if (taskId) {
    folderName = taskId;
  } else {
    folderName = `session-${Date.now()}`;
  }

  return join(sessionsDir, folderName);
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string
): Promise<string[]> {
  const savedPaths: string[] = [];
  if (images.length === 0) return savedPaths;

  await ensureDir(workDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.mimeType.split('/')[1] || 'png';
    const filename = `image_${Date.now()}_${i}.${ext}`;
    const filePath = join(workDir, filename);

    try {
      let base64Data = image.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      logger.info(`[CodeAny] Saved image to: ${filePath}`);
    } catch (error) {
      logger.error(`[CodeAny] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

// ============================================================================
// Default tools
// ============================================================================

const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'Task',
  'LSP',
  'TodoWrite',
  'Agent',       // 多 Agent 并行协作（AgentTool）
  'SendMessage', // 跨 Agent 消息传递
];

// ============================================================================
// CodeAny Agent class
// ============================================================================

export class CodeAnyAgent extends BaseAgent {
  readonly provider: AgentProvider = 'codeany';

  /**
   * Queue of artifact blocks intercepted from tool outputs.
   * Drained in processMessage() and yielded as text messages to the frontend.
   */
  private pendingArtifacts: string[] = [];

  constructor(config: AgentConfig) {
    super(config);
    logger.info('[CodeAnyAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  private looksLikeError(output: string): boolean {
    if (!output || output.length < 10) return false;
    const lower = output.toLowerCase();
    const errorPatterns = [
      'error:', 'exception:', 'traceback', 'econnrefused',
      'etimedout', 'enotfound', 'status_code', 'failed to',
      'permission denied', '401', '403', '500', '502', '503',
    ];
    return errorPatterns.some(p => lower.includes(p)) && output.length < 500;
  }

  private buildSdkOptions(
    sessionCwd: string,
    options?: AgentOptions,
    extraOpts?: Partial<SdkAgentOptions>,
    systemPrompt?: string
  ): SdkAgentOptions {
    const sdkOpts: SdkAgentOptions = {
      cwd: sessionCwd,
      model: this.config.model,
      permissionMode: 'bypassPermissions',
      maxTurns: 12,
      thinking: { type: 'adaptive' },
      ...extraOpts,
    };

    // Set API type
    if (this.config.apiType) {
      (sdkOpts as any).apiType = this.config.apiType;
    }

    // Set API credentials
    if (this.config.apiKey) {
      sdkOpts.apiKey = this.config.apiKey;
    }
    if (this.config.baseUrl) {
      sdkOpts.baseURL = stripHashSuffix(this.config.baseUrl);
    }

    // Inject SOUL.md + AGENTS.md + memory as a proper system prompt field.
    // For OpenAI-compatible APIs (e.g. MiniMax) the SDK passes this as the
    // system message, ensuring the model treats it as instructions rather than
    // user input.  appendSystemPrompt appends after the SDK's built-in prompt.
    if (systemPrompt) {
      sdkOpts.appendSystemPrompt = systemPrompt;
    }

    // Set allowed tools
    sdkOpts.allowedTools = options?.allowedTools || ALLOWED_TOOLS;

    // Set abort controller
    if (options?.abortController) {
      sdkOpts.abortController = options.abortController;
    }

    // Register PostToolUse hook for deterministic data interception.
    // Detects westock API calls from command URL patterns + response structure,
    // queues artifact blocks for direct frontend rendering, and replaces the
    // LLM's tool_output with a concise summary (~200 chars vs ~10K chars).
    const agent = this;
    sdkOpts.hooks = {
      ...((sdkOpts as any).hooks || {}),
      PostToolUse: [{
        matcher: 'Bash',
        hooks: [async (input: any) => {
          const toolOutput = typeof input.toolOutput === 'string' ? input.toolOutput : '';
          // Extract the Bash command string from toolInput
          const command = typeof input.toolInput === 'object' && input.toolInput
            ? (input.toolInput.command || '')
            : (typeof input.toolInput === 'string' ? input.toolInput : '');
          const result = interceptToolOutput(command, toolOutput);
          if (!result) return undefined;

          // Queue artifact block for frontend rendering
          agent.pendingArtifacts.push(result.artifactBlock);

          logger.info(`[PostToolUse] Intercepted → ${result.metadata.skill}/${result.metadata.action}, artifact queued, summary ${result.summary.length} chars`);

          // Return summary to replace the tool output the LLM sees
          return { modifiedOutput: result.summary };
        }],
      }],
    };

    return sdkOpts;
  }

  /**
   * Build conversation context using the Context Assembler.
   * Supports disk-persisted sessions and automatic compaction.
   */
  private async buildConversationContext(
    sessionId: string,
    conversation?: ConversationMessage[]
  ): Promise<string> {
    if (!conversation || conversation.length === 0) return '';

    try {
      const { assembleContext } = await import('@/shared/context/assembler');
      const maxContextTokens = (this.config.providerConfig?.maxHistoryTokens as number) || 12000;

      const result = await assembleContext(sessionId, conversation, {
        maxContextTokens,
      });

      if (result.compacted) {
        logger.info(`[CodeAny ${sessionId}] Context compacted: ${result.estimatedTokens} tokens, ${result.recentMessageCount} recent messages kept`);
      }

      return result.context;
    } catch (err) {
      logger.warn(`[CodeAny ${sessionId}] Context assembly failed, falling back:`, err);
      return this.formatConversationHistoryFallback(conversation);
    }
  }

  /**
   * Fallback: simple truncation (used when assembler fails).
   */
  private formatConversationHistoryFallback(conversation: ConversationMessage[]): string {
    const maxTokens = (this.config.providerConfig?.maxHistoryTokens as number) || 12000;
    const parts: string[] = [];
    let budget = maxTokens;

    for (let i = conversation.length - 1; i >= 0 && budget > 0; i--) {
      const msg = conversation[i];
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const line = `${role}: ${msg.content}`;
      const tokens = Math.ceil(line.length / 4);
      if (budget - tokens < 0 && parts.length >= 2) break;
      parts.unshift(line);
      budget -= tokens;
    }

    if (parts.length === 0) return '';
    return `## Previous Conversation Context\n\n${parts.join('\n\n')}\n\n---\n## Current Request\n`;
  }

  private sanitizeText(text: string): string {
    let sanitized = text;

    // Strip reasoning tags emitted by MiniMax and other thinking models
    // (e.g. <think>...</think>) — they should never be shown to the user.
    sanitized = sanitized.replace(/<think>[\s\S]*?<\/think>\s*/g, '');

    // Strip MiniMax fake tool-call text blocks that leak to UI.
    // MiniMax sometimes "says" tool calls as text instead of using the API's
    // tool_use mechanism, producing blocks like:
    //   [TOOL_CALL] {tool => "Skill", args => { ... }} [/TOOL_CALL]
    sanitized = sanitized.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]\s*/g, '');

    const apiKeyErrorPatterns = [
      /Invalid API key/i, /invalid_api_key/i, /API key.*invalid/i,
      /authentication.*fail/i, /Unauthorized/i,
      /身份验证失败/, /认证失败/, /鉴权失败/, /密钥无效/,
    ];

    if (apiKeyErrorPatterns.some((p) => p.test(sanitized))) {
      return '__API_KEY_ERROR__';
    }

    return sanitized;
  }

  private *processMessage(
    message: unknown,
    sessionId: string,
    sentTextHashes: Set<string>,
    sentToolIds: Set<string>
  ): Generator<AgentMessage> {
    const msg = message as {
      type: string;
      message?: { content?: unknown[] };
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      result?: { tool_use_id?: string; tool_name?: string; output?: string };
    };

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('text' in block) {
          const sanitizedText = this.sanitizeText(block.text as string);
          const textHash = sanitizedText.slice(0, 100);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            yield { type: 'text', content: sanitizedText };
          }
        } else if ('name' in block && 'id' in block) {
          const toolId = block.id as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            yield { type: 'tool_use', id: toolId, name: block.name as string, input: block.input };
          }
        }
      }
    }

    if (msg.type === 'tool_result' && msg.result) {
      const output = msg.result.output ?? '';
      const isError = !!(msg.result as any).is_error || this.looksLikeError(output);
      yield {
        type: 'tool_result',
        toolUseId: msg.result.tool_use_id ?? '',
        name: msg.result.tool_name ?? undefined,
        output,
        isError,
      };

      // Flush any artifact blocks queued by the PostToolUse hook.
      // These are yielded as text messages so the frontend's artifactParser
      // extracts and renders them — identical to LLM-generated artifact blocks.
      while (this.pendingArtifacts.length > 0) {
        const artifactBlock = this.pendingArtifacts.shift()!;
        yield { type: 'text', content: artifactBlock };
      }
    }

    if (msg.type === 'result') {
      yield {
        type: 'result', content: msg.subtype,
        cost: msg.total_cost_usd, duration: msg.duration_ms,
      };
    }
  }

  // ==========================================================================
  // Core agent methods
  // ==========================================================================

  async *run(prompt: string, options?: AgentOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir, prompt, options?.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[CodeAny ${session.id}] Working Directory: ${sessionCwd}`);

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();
    // Accumulates assistant reply text for daily memory write
    const assistantTextParts: string[] = [];

    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    // Save images to disk so they can be referenced in the text prompt
    // (The SDK's query() accepts string only; multimodal arrays are not supported)
    let imagePaths: string[] = [];
    if (options?.images && options.images.length > 0) {
      imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      if (imagePaths.length > 0) {
        logger.info(`[CodeAny] Saved ${imagePaths.length} image(s) to disk`);
      }
    }

    // Use taskId as persistent context key (stable across turns); fall back to session.id
    const contextSessionId = options?.taskId || session.id;
    const conversationContext = await this.buildConversationContext(contextSessionId, options?.conversation);
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);
    const sageSystemPrompt = await getSageSystemPrompt(prompt);

    // System prompt (SOUL.md + AGENTS.md + memory) is injected via SDK's
    // appendSystemPrompt so OpenAI-compatible APIs treat it as a system message.
    // Only workspace/conversation/language context remains in the text prompt.
    const textPrompt = getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext + languageInstruction + prompt;

    // Build the final prompt: always a string (images referenced by file path)
    let finalPrompt: string;
    if (imagePaths.length > 0) {
      finalPrompt = textPrompt + `\n\n[Attached image file(s) saved to disk: ${imagePaths.join(', ')}]`;
      logger.info(`[CodeAny] Using text prompt with ${imagePaths.length} image path(s) appended`);
    } else {
      finalPrompt = textPrompt;
    }

    // Load MCP servers
    const userMcpServers = await loadMcpServers(options?.mcpConfig as McpConfig | undefined);

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      abortController: options?.abortController || session.abortController,
    }, sageSystemPrompt);

    // Add MCP servers if any
    if (Object.keys(userMcpServers).length > 0) {
      sdkOpts.mcpServers = userMcpServers;
      logger.info(`[CodeAny ${session.id}] MCP servers: ${Object.keys(userMcpServers).join(', ')}`);
    }

    logger.info(`[CodeAny ${session.id}] ========== AGENT START ==========`);
    logger.info(`[CodeAny ${session.id}] Model: ${this.config.model || '(default)'}`);
    logger.info(`[CodeAny ${session.id}] Custom API: ${this.isUsingCustomApi()}`);
    logger.info(`[CodeAny ${session.id}] Prompt length: ${finalPrompt.length} chars`);
    logger.info(`[CodeAny ${session.id}] Images (disk): ${imagePaths.length > 0 ? `yes (${imagePaths.length} files)` : 'no'}`);

    // Dynamically swap in only the skills relevant to this prompt
    // so the model context stays lean each turn.
    await refreshSkillsForPrompt(prompt);

    try {
      // ------------------------------------------------------------------
      // Run the SDK query, with silent auto-retry for "announce-only" turns.
      //
      // MiniMax sometimes outputs only an intent statement ("我来帮你查询...")
      // without making any tool calls, then stops. When this happens we
      // transparently re-enter the agentic loop with a continuation prompt.
      // Max 1 retry to prevent infinite loops.
      // ------------------------------------------------------------------
      let currentPrompt = finalPrompt;
      const MAX_EMPTY_RETRIES = 1;
      const MAX_TOOL_CALLS = 20;
      let emptyRetries = 0;
      let totalToolCalls = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let hadToolUse = false;

        for await (const message of query({ prompt: currentPrompt, options: sdkOpts })) {
          if (session.abortController.signal.aborted) break;
          for (const msg of this.processMessage(message, session.id, sentTextHashes, sentToolIds)) {
            if (msg.type === 'text' && (msg as any).content) {
              assistantTextParts.push((msg as any).content);
            }
            if (msg.type === 'tool_use' || msg.type === 'tool_result') {
              hadToolUse = true;
              if (msg.type === 'tool_use') totalToolCalls++;
            }
            yield msg;
          }
          // Log when tool call limit is approaching (SDK will naturally stop at maxTurns)
          if (totalToolCalls >= MAX_TOOL_CALLS) {
            logger.warn(`[CodeAny ${session.id}] Tool call limit (${MAX_TOOL_CALLS}) reached, SDK maxTurns will handle termination.`);
          }
        }

        // If the LLM used tools or the session was aborted, we're done.
        if (hadToolUse || session.abortController.signal.aborted) break;

        // Safety: stop if too many tool calls accumulated
        if (totalToolCalls >= MAX_TOOL_CALLS) {
          logger.warn(`[CodeAny ${session.id}] Tool call limit (${MAX_TOOL_CALLS}) reached, stopping.`);
          break;
        }

        // If the LLM produced substantive text (not just empty/whitespace),
        // it answered without tools — that's a valid response, not an "empty turn".
        const hasSubstantiveText = assistantTextParts.some(t => t.trim().length > 20);
        if (hasSubstantiveText) break;

        // No tools AND no real text — this is an "announce-only" turn
        // (e.g. MiniMax says "我来帮你查询..." without actually calling tools).
        // Silently retry once.
        if (emptyRetries >= MAX_EMPTY_RETRIES) break;

        emptyRetries++;
        logger.info(`[CodeAny ${session.id}] Empty turn detected (no tool calls, no text). Silent retry ${emptyRetries}/${MAX_EMPTY_RETRIES}.`);
        currentPrompt = '继续执行，请直接调用工具获取数据，不要重复描述你要做什么。';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CodeAny ${session.id}] Error:`, { message: errorMessage });

      const noApiKeyConfigured = !this.config.apiKey;
      const usingCustomApi = this.isUsingCustomApi();

      const isApiKeyError =
        errorMessage.includes('Invalid API key') || errorMessage.includes('invalid_api_key') ||
        errorMessage.includes('API key') || errorMessage.includes('authentication') ||
        errorMessage.includes('Unauthorized') || errorMessage.includes('401') ||
        errorMessage.includes('403') || noApiKeyConfigured;

      const isApiCompatibilityError = usingCustomApi && (
        errorMessage.includes('model') || errorMessage.includes('not found')
      );

      if (isApiKeyError) {
        yield { type: 'error', message: '__API_KEY_ERROR__' };
      } else if (isApiCompatibilityError) {
        yield { type: 'error', message: `__CUSTOM_API_ERROR__|${this.config.baseUrl}|${LOG_FILE_PATH}` };
      } else {
        yield { type: 'error', message: `__INTERNAL_ERROR__|${LOG_FILE_PATH}` };
      }
    } finally {
      // Persist this turn to daily memory (fire-and-forget)
      const assistantReply = assistantTextParts.join('\n').trim();
      if (assistantReply) {
        appendDailyMemory(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), assistantReply);
      }

      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *plan(prompt: string, options?: PlanOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir, prompt, options?.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[CodeAny ${session.id}] Planning started, cwd: ${sessionCwd}`);

    const workspaceInstruction = `\n## CRITICAL: Output Directory\n**ALL files must be saved to: ${sessionCwd}**\n`;
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);
    const sageSystemPrompt = await getSageSystemPrompt(prompt);
    const planningPrompt = workspaceInstruction + PLANNING_INSTRUCTION + languageInstruction + prompt;

    let fullResponse = '';

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      allowedTools: [],
      abortController: options?.abortController || session.abortController,
    }, sageSystemPrompt);

    try {
      for await (const message of query({ prompt: planningPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;

        if ((message as any).type === 'assistant' && (message as any).message?.content) {
          for (const block of (message as any).message.content) {
            if ('text' in block) {
              // planning phase 必须和 run() 一样走 sanitizeText，
              // 否则 MiniMax 等 thinking 模型的 <think>...</think> 原文会直接
              // 漏到 UI / transcript 里（已见于线上 minimax 反馈日志）。
              const sanitizedText = this.sanitizeText(block.text);
              fullResponse += block.text; // fullResponse 给 parser 用原文
              if (sanitizedText) {
                yield { type: 'text', content: sanitizedText };
              }
            }
          }
        }
      }

      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === 'direct_answer') {
        yield { type: 'direct_answer', content: planningResult.answer };
      } else if (planningResult?.type === 'plan' && planningResult.plan.steps.length > 0) {
        this.storePlan(planningResult.plan);
        yield { type: 'plan', plan: planningResult.plan };
      } else {
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          yield { type: 'plan', plan };
        } else {
          // Fallback: 当 parser 识别不出任何结构化产物时，
          // 上面的循环已经把 block.text 作为 text 消息流式 yield 给 UI 了，
          // 这里如果再把 fullResponse 打包成 direct_answer，UI 会把同样内容
          // 再追加一次（direct_answer 被渲染为 text）— 造成 transcript 里的
          // "block 4 = block 1+2+3 合并" 重复问题（见 minimax 反馈日志）。
          // 仅 yield done，让已经流式输出的 text 自己闭合。
          logger.warn(
            `[CodeAny ${session.id}] Planning produced unstructured response; ` +
            `streamed as text already, skipping duplicate direct_answer fallback.`
          );
        }
      }
    } catch (error) {
      logger.error(`[CodeAny ${session.id}] Planning error:`, error);
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      // Persist planning turn to daily memory (fire-and-forget)
      if (fullResponse.trim()) {
        appendDailyMemory(prompt, fullResponse.trim());
      }
      yield { type: 'done' };
    }
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options.sessionId,
      abortController: options.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir, options.originalPrompt, options.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[CodeAny ${session.id}] Executing plan: ${plan.id}, cwd: ${sessionCwd}`);

    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    const sageSystemPrompt = await getSageSystemPrompt(options.originalPrompt);
    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts, options.language, options.originalPrompt) +
      '\n\nOriginal request: ' + options.originalPrompt;

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();
    // Accumulates assistant reply text for daily memory write
    const assistantTextParts: string[] = [];

    const userMcpServers = await loadMcpServers(options.mcpConfig as McpConfig | undefined);

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      abortController: options.abortController || session.abortController,
    }, sageSystemPrompt);

    if (Object.keys(userMcpServers).length > 0) {
      sdkOpts.mcpServers = userMcpServers;
    }

    // Dynamically swap in only the skills relevant to this plan's original prompt
    if (options.originalPrompt) {
      await refreshSkillsForPrompt(options.originalPrompt);
    }

    try {
      for await (const message of query({ prompt: executionPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;
        for (const msg of this.processMessage(message, session.id, sentTextHashes, sentToolIds)) {
          if (msg.type === 'text' && (msg as any).content) {
            assistantTextParts.push((msg as any).content);
          }
          yield msg;
        }
      }
    } catch (error) {
      logger.error(`[CodeAny ${session.id}] Execution error:`, error);
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      // Persist execution turn to daily memory (fire-and-forget)
      const assistantReply = assistantTextParts.join('\n').trim();
      if (assistantReply && options.originalPrompt) {
        appendDailyMemory(options.originalPrompt, assistantReply);
      }

      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }
}

// ============================================================================
// Factory & Plugin
// ============================================================================

export function createCodeAnyAgent(config: AgentConfig): CodeAnyAgent {
  return new CodeAnyAgent(config);
}

export const codeanyPlugin: AgentPlugin = defineAgentPlugin({
  metadata: CODEANY_METADATA,
  factory: (config) => createCodeAnyAgent(config),
});

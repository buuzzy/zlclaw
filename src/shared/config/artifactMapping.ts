/**
 * Artifact Mapping Configuration
 * 
 * Maps (skill, action) tuples to artifact component types for deterministic rendering.
 * This enables the frontend to automatically select the correct component without
 * relying on explicit artifact blocks or implicit response structure detection.
 */

export type ArtifactType =
  | 'quote-card'
  | 'kline-chart'
  | 'intraday-chart'
  | 'news-list'
  | 'data-table'
  | 'line-chart'
  | 'text';

/**
 * Tool metadata structure parsed from skill responses
 */
export interface ToolMetadata {
  skill: string;      // e.g., "westock-quote", "westock-market"
  action: string;     // e.g., "stock_quote_snapshot", "hot_stock"
  list_code?: string; // Optional: for screener list queries like "macro_cpi_ppi"
}

/**
 * Primary artifact mapping: (skill, action) → artifact type
 */
const SKILL_ACTION_MAPPING: Record<string, Record<string, ArtifactType>> = {
  'westock-quote': {
    'stock_quote_snapshot': 'quote-card',
    'stock_quote_history': 'kline-chart',
    'intraday_chart': 'intraday-chart',
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
    // For query_list_data_by_date, artifact type depends on list_code
    'query_list_data_by_date': 'data-table', // default fallback
  },
};

/**
 * Secondary mapping for westock-screener list codes
 * Used when action is "query_list_data_by_date" and list_code is present
 */
const SCREENER_LIST_CODE_MAPPING: Record<string, ArtifactType> = {
  // Index and board lists
  'index_list': 'data-table',
  'industry_list': 'data-table',
  'industry_list_sw1': 'data-table',
  'industry_list_sw2': 'data-table',
  'industry_list_sw3': 'data-table',
  'sh_connected_stocks': 'data-table',
  'sz_connected_stocks': 'data-table',
  // Macro indicators (time series)
  'macro_cpi_ppi': 'line-chart',
  'macro_gdp': 'line-chart',
  'macro_pmi': 'line-chart',
  'macro_fundquantity': 'line-chart',
  'macro_consumption': 'line-chart',
  // Macro indicators (snapshot/summary)
  'macro_financing': 'data-table',
  'macro_profit': 'data-table',
  'macro_core_indicatros_cur': 'data-table',
};

/**
 * Determine artifact type from tool metadata
 * 
 * @param metadata - Tool metadata extracted from skill response
 * @returns Artifact type to render, or null if not determinable
 */
export function determineArtifactType(metadata: ToolMetadata): ArtifactType | null {
  const { skill, action, list_code } = metadata;

  // Validate inputs
  if (!skill || !action) {
    console.warn('determineArtifactType: missing skill or action', metadata);
    return null;
  }

  // Handle westock-screener with list_code
  if (skill === 'westock-screener' && action === 'query_list_data_by_date' && list_code) {
    const mapped = SCREENER_LIST_CODE_MAPPING[list_code];
    if (mapped) {
      return mapped;
    }
    // Fallback to default for unknown list codes
    console.warn(
      `determineArtifactType: unknown screener list_code "${list_code}", using data-table fallback`,
      metadata
    );
    return 'data-table';
  }

  // Primary lookup: (skill, action)
  const skillMapping = SKILL_ACTION_MAPPING[skill];
  if (!skillMapping) {
    console.warn(`determineArtifactType: unknown skill "${skill}"`, metadata);
    return null;
  }

  const artifactType = skillMapping[action];
  if (!artifactType) {
    console.warn(
      `determineArtifactType: unknown action "${action}" for skill "${skill}"`,
      metadata
    );
    return null;
  }

  return artifactType;
}

/**
 * Parse tool metadata from JSON string (as stored in database)
 * 
 * @param jsonStr - JSON string of ToolMetadata from database
 * @returns Parsed metadata or null if invalid
 */
export function parseToolMetadata(jsonStr: string | null | undefined): ToolMetadata | null {
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr) as ToolMetadata;
  } catch (error) {
    console.warn('parseToolMetadata: failed to parse', jsonStr, error);
    return null;
  }
}

/**
 * Serialize tool metadata to JSON string for database storage
 */
export function serializeToolMetadata(metadata: ToolMetadata): string {
  return JSON.stringify(metadata);
}

/**
 * Get all registered artifact types
 */
export function getRegisteredArtifactTypes(): ArtifactType[] {
  const types = new Set<ArtifactType>();
  
  // Collect from skill-action mapping
  Object.values(SKILL_ACTION_MAPPING).forEach(actionMap => {
    Object.values(actionMap).forEach(type => types.add(type));
  });
  
  // Collect from list code mapping
  Object.values(SCREENER_LIST_CODE_MAPPING).forEach(type => types.add(type));
  
  return Array.from(types);
}

/**
 * Debug: Log all artifact mappings
 */
export function debugLogArtifactMappings(): void {
  console.group('Artifact Mappings');
  console.log('Skill-Action Mappings:', SKILL_ACTION_MAPPING);
  console.log('Screener List Code Mappings:', SCREENER_LIST_CODE_MAPPING);
  console.log('Registered Types:', getRegisteredArtifactTypes());
  console.groupEnd();
}

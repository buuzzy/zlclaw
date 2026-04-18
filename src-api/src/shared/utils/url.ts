/**
 * Build a full chat/messages endpoint URL from a user-supplied base URL.
 *
 * Convention:
 *   - Normal:   "https://example.com/api" → append "/v1<suffix>"
 *   - Has /v1:  "https://example.com/api/v1" → append "<suffix>" only
 *   - Ends #:   "https://example.com/api/llmproxy#" → strip '#', append "<suffix>" (skip /v1)
 *
 * @param baseUrl  The raw URL stored in config (may end with '#')
 * @param suffix   Path to append, e.g. "/chat/completions" or "/messages"
 */
export function buildEndpointUrl(baseUrl: string, suffix: string): string {
  // '#' suffix = user explicitly disabled auto /v1 insertion
  if (baseUrl.endsWith('#')) {
    const base = baseUrl.slice(0, -1).replace(/\/+$/, '');
    return `${base}${suffix}`;
  }

  const base = baseUrl.replace(/\/+$/, '');

  // Already has the full path
  if (base.endsWith('/chat/completions') || base.endsWith('/messages')) {
    return base;
  }

  // Already ends with /v1, just append suffix
  if (base.endsWith('/v1')) {
    return `${base}${suffix}`;
  }

  // Default: insert /v1
  return `${base}/v1${suffix}`;
}

/**
 * Strip the '#' sentinel from a base URL so it can be safely passed
 * to an SDK that manages its own path construction (e.g. Anthropic SDK).
 */
export function stripHashSuffix(baseUrl: string): string {
  return baseUrl.endsWith('#') ? baseUrl.slice(0, -1).replace(/\/+$/, '') : baseUrl;
}

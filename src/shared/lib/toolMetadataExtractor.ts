/**
 * Tool Metadata Extraction Utilities
 * 
 * Handles extraction and parsing of tool_metadata from skill responses
 * for deterministic artifact mapping.
 */

import type { ToolMetadata } from '@/shared/config/artifactMapping';

/**
 * Extract tool metadata from tool output JSON string
 * 
 * Looks for _metadata field in the JSON response, following this structure:
 * ```json
 * {
 *   "code": 0,
 *   "data": {...},
 *   "_metadata": {
 *     "skill": "westock-quote",
 *     "action": "stock_quote_snapshot",
 *     "list_code": "optional_value"
 *   }
 * }
 * ```
 * 
 * @param toolOutput - JSON string returned by tool
 * @param toolName - Name of the tool (for context/debugging)
 * @returns Parsed ToolMetadata or null if not found/invalid
 */
export function extractToolMetadata(
  toolOutput: string | undefined,
  toolName?: string
): ToolMetadata | null {
  if (!toolOutput) {
    return null;
  }

  try {
    // Try to parse the tool output as JSON
    const parsed = JSON.parse(toolOutput);

    // Look for _metadata field
    if (parsed._metadata && typeof parsed._metadata === 'object') {
      const metadata = parsed._metadata as Partial<ToolMetadata>;

      // Validate required fields
      if (metadata.skill && metadata.action) {
        return {
          skill: String(metadata.skill),
          action: String(metadata.action),
          list_code: metadata.list_code ? String(metadata.list_code) : undefined,
        };
      }
    }

    return null;
  } catch (error) {
    // Tool output is not JSON or parsing failed
    if (toolName) {
      console.debug(
        `[toolMetadataExtractor] ${toolName}: tool output is not JSON or _metadata not found`,
        error
      );
    }
    return null;
  }
}

/**
 * Extract metadata from a tool result message
 * 
 * @param toolName - Name of the tool
 * @param toolOutput - Tool output string
 * @returns Metadata object or null
 */
export function extractMetadataFromToolResult(
  toolName: string | undefined,
  toolOutput: string | undefined
): ToolMetadata | null {
  // Only attempt extraction for Skill tool
  if (toolName !== 'Skill') {
    return null;
  }

  return extractToolMetadata(toolOutput, toolName);
}

/**
 * Serialize metadata for storage in database
 */
export function serializeMetadata(metadata: ToolMetadata | null): string | null {
  if (!metadata) return null;
  try {
    return JSON.stringify(metadata);
  } catch (error) {
    console.error('[toolMetadataExtractor] Failed to serialize metadata:', error);
    return null;
  }
}

/**
 * Parse metadata from database storage
 */
export function parseMetadata(
  metadataJson: string | null | undefined
): ToolMetadata | null {
  if (!metadataJson) return null;
  try {
    return JSON.parse(metadataJson) as ToolMetadata;
  } catch (error) {
    console.error('[toolMetadataExtractor] Failed to parse metadata:', error);
    return null;
  }
}

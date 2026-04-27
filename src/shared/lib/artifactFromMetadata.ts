/**
 * Generate Artifact from Tool Metadata
 *
 * This module provides utilities to automatically create Artifact objects
 * from tool metadata and tool output, enabling deterministic artifact rendering
 * based on skill/action combinations without requiring explicit artifact blocks.
 */

import type { Artifact } from '@/shared/types/artifact';
import { determineArtifactType, type ToolMetadata } from '@/shared/config/artifactMapping';
import { parseToolMetadata } from '@/shared/config/artifactMapping';

/**
 * Generate an Artifact from tool metadata and output
 * 
 * @param toolName - Name of the tool (e.g., "Skill")
 * @param toolOutput - Raw tool output string
 * @param toolMetadataJson - JSON string of tool metadata from database
 * @returns Artifact object if determinable, or null if not applicable
 */
export function generateArtifactFromMetadata(
  toolName: string | null | undefined,
  toolOutput: string | null | undefined,
  toolMetadataJson: string | null | undefined
): Artifact | null {
  // Only process Skill tool outputs
  if (toolName !== 'Skill') {
    return null;
  }

  // Need both metadata and output
  if (!toolMetadataJson || !toolOutput) {
    return null;
  }

  // Parse metadata
  const metadata = parseToolMetadata(toolMetadataJson);
  if (!metadata) {
    return null;
  }

  // Determine artifact type
  const artifactType = determineArtifactType(metadata);
  if (!artifactType) {
    return null;
  }

  // Parse tool output to extract data
  let toolData: any;
  try {
    toolData = JSON.parse(toolOutput);
  } catch (error) {
    console.warn(
      '[artifactFromMetadata] Failed to parse tool output as JSON',
      error
    );
    return null;
  }

  // Extract data based on artifact type
  // Most skill responses have data in the "data" field
  const artifactData = toolData.data || toolData;

  // Generate unique ID
  const artifactId = `art_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    id: artifactId,
    type: artifactType,
    data: artifactData,
  };
}

/**
 * Generate artifacts from a message that has tool metadata
 * 
 * Typically called for tool_result messages to create implicit artifacts
 * 
 * @param message - Message object with tool metadata fields
 * @returns Array of generated artifacts (0 or 1 items)
 */
export function generateArtifactsFromMessage(message: {
  type: string;
  tool_name?: string | null;
  tool_output?: string | null;
  tool_metadata?: string | null;
}): Artifact[] {
  if (message.type !== 'tool_result') {
    return [];
  }

  const artifact = generateArtifactFromMetadata(
    message.tool_name,
    message.tool_output,
    message.tool_metadata
  );

  return artifact ? [artifact] : [];
}

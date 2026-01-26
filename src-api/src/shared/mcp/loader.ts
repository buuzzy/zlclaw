/**
 * MCP Config Loader
 *
 * Loads MCP server configuration from multiple sources:
 * - ~/.workany/mcp.json (WorkAny specific)
 * - ~/.claude/settings.json (Claude Code system config)
 */

import fs from 'fs/promises';

import {
  getAllMcpConfigPaths,
  getWorkanyMcpConfigPath,
} from '@/config/constants';

// MCP Server Config Types (matching SDK types)
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

// WorkAny MCP Config file format
interface _WorkAnyMcpConfig {
  mcpServers: Record<
    string,
    {
      // Stdio config
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      // HTTP config
      url?: string;
      headers?: Record<string, string>;
    }
  >;
}

/**
 * Get all MCP config paths to check
 */
export function getMcpConfigPaths(): { name: string; path: string }[] {
  return getAllMcpConfigPaths();
}

/**
 * Get the primary MCP config path (for backward compatibility)
 */
export function getMcpConfigPath(): string {
  return getWorkanyMcpConfigPath();
}

/**
 * Load MCP servers from a single config file
 */
async function loadMcpServersFromFile(
  configPath: string,
  sourceName: string
): Promise<Record<string, McpServerConfig>> {
  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Support both formats: { mcpServers: {...} } and direct { serverName: {...} }
    const mcpServers = config.mcpServers || config;

    if (!mcpServers || typeof mcpServers !== 'object') {
      return {};
    }

    const servers: Record<string, McpServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      const cfg = serverConfig as Record<string, unknown>;
      if (cfg.url) {
        servers[name] = {
          type: 'http',
          url: cfg.url as string,
          headers: cfg.headers as Record<string, string>,
        };
        console.log(`[MCP] Loaded HTTP server from ${sourceName}: ${name}`);
      } else if (cfg.command) {
        servers[name] = {
          type: 'stdio',
          command: cfg.command as string,
          args: cfg.args as string[],
          env: cfg.env as Record<string, string>,
        };
        console.log(`[MCP] Loaded stdio server from ${sourceName}: ${name}`);
      }
    }

    return servers;
  } catch {
    return {};
  }
}

/**
 * MCP configuration interface
 */
export interface McpConfig {
  enabled: boolean;
  userDirEnabled: boolean;
  appDirEnabled: boolean;
  mcpConfigPath?: string;
}

/**
 * Load MCP servers configuration from multiple sources:
 * - ~/.workany/mcp.json (WorkAny specific / App directory)
 * - ~/.claude/settings.json (Claude Code system config / User directory)
 *
 * @param mcpConfig Optional config to filter which sources to load
 * @returns Record of server name to config, merged from all sources
 */
export async function loadMcpServers(
  mcpConfig?: McpConfig
): Promise<Record<string, McpServerConfig>> {
  // If MCP is globally disabled, return empty
  if (mcpConfig && !mcpConfig.enabled) {
    console.log('[MCP] MCP disabled globally, skipping server load');
    return {};
  }

  const configPaths = getMcpConfigPaths();
  const allServers: Record<string, McpServerConfig> = {};

  for (const { name, path: configPath } of configPaths) {
    // Filter based on mcpConfig settings
    if (mcpConfig) {
      // 'workany' = App directory, 'claude' = User directory
      if (name === 'workany' && mcpConfig.appDirEnabled === false) {
        console.log('[MCP] App directory MCP disabled, skipping workany config');
        continue;
      }
      if (name === 'claude' && mcpConfig.userDirEnabled === false) {
        console.log('[MCP] User directory MCP disabled, skipping claude config');
        continue;
      }
    }

    const servers = await loadMcpServersFromFile(configPath, name);
    // Merge servers, workany config takes precedence over claude
    Object.assign(allServers, servers);
  }

  const serverCount = Object.keys(allServers).length;
  if (serverCount > 0) {
    console.log(`[MCP] Loaded ${serverCount} MCP server(s) total`);
  } else {
    console.log('[MCP] No MCP servers found in any config');
  }

  return allServers;
}

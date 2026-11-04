// Faux serveur MCP (stdio) imitant deux outils de Roblox Studio, pour les tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'fake-roblox', version: '1.0.0' })
server.registerTool('list_roblox_studios', { description: 'Liste les Studios ouverts', annotations: { readOnlyHint: true } }, async () => ({
  content: [{ type: 'text', text: '[{"studio_id":"abc","place":"Obby"}]' }]
}))
server.registerTool('execute_luau', { description: 'Exécute du Luau', inputSchema: { studio_id: z.string(), code: z.string() } }, async ({ code }) => ({
  content: [{ type: 'text', text: `exécuté (${code.length} caractères)` }]
}))
await server.connect(new StdioServerTransport())

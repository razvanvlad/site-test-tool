import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { initDb } from '../src/db.js';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const server = new Server(
  {
    name: 'site-audit',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'run_audit',
        description: 'Runs a full site audit (Lighthouse, Playwright, axe, linkinator) against a target URL. Returns a summary of findings.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The fully qualified URL to audit (e.g. https://example.com)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'get_findings',
        description: 'Fetches the findings for a specific audit run.',
        inputSchema: {
          type: 'object',
          properties: {
            auditId: { type: 'number', description: 'The ID of the audit run' },
            format: { type: 'string', enum: ['json', 'markdown'], description: 'Format to return the findings in. Use json for programmatic inspection, markdown for human readability.' },
          },
          required: ['auditId', 'format'],
        },
      },
      {
        name: 'compare_screenshots',
        description: 'Captures a new "after" screenshot for a finding, runs pixelmatch to compare with the original "before" screenshot, and saves the diff metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            findingId: { type: 'number', description: 'The ID of the finding to verify the fix for' },
          },
          required: ['findingId'],
        },
      },
      {
        name: 'get_action_tasks',
        description: 'Fetches the interactive AI action tasks for a specific audit run.',
        inputSchema: {
          type: 'object',
          properties: {
            auditId: { type: 'number', description: 'The ID of the audit run' },
          },
          required: ['auditId'],
        },
      },
      {
        name: 'update_action_task',
        description: 'Updates a specific action task (status and agentNotes) for an audit.',
        inputSchema: {
          type: 'object',
          properties: {
            auditId: { type: 'number', description: 'The ID of the audit run' },
            taskId: { type: 'string', description: 'The unique ID of the task to update' },
            status: { type: 'string', enum: ['open', 'done'], description: 'The new status of the task' },
            agentNotes: { type: 'string', description: 'Notes on how the task was resolved' }
          },
          required: ['auditId', 'taskId', 'status', 'agentNotes'],
        },
      },
    ],
  };
});

// Handle tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'run_audit') {
      const url = args.url;
      if (!url) throw new Error('Missing url parameter');
      
      console.error(`[MCP] Starting audit for ${url}...`);
      
      // Spawn node audit.js in the root directory
      const { stdout, stderr } = await execPromise(`node audit.js "${url}"`, { cwd: rootDir });
      
      // audit.js writes the final output summary to stdout. We can just return it.
      // But wait! If we just return the full stdout, that's fine.
      return {
        content: [
          {
            type: 'text',
            text: `Audit completed successfully.\n\nOutput:\n${stdout}`,
          },
        ],
      };
    }

    if (name === 'get_findings') {
      const { auditId, format } = args;
      if (!auditId) throw new Error('Missing auditId parameter');
      
      const db = initDb();
      const findings = db.prepare('SELECT * FROM findings WHERE audit_id = ?').all(auditId);
      
      if (format === 'json') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(findings, null, 2),
            },
          ],
        };
      } else {
        // Markdown format
        let md = `## Findings for Audit #${auditId}\n\n`;
        md += `| ID | Tool | Category | Severity | Title | Status |\n`;
        md += `|---|---|---|---|---|---|\n`;
        for (const f of findings) {
          md += `| ${f.id} | ${f.source_tool || 'unknown'} | ${f.category} | ${f.severity} | ${f.title.replace(/\n/g, ' ').substring(0, 50)}... | ${f.status} |\n`;
        }
        return {
          content: [
            {
              type: 'text',
              text: md,
            },
          ],
        };
      }
    }

    if (name === 'compare_screenshots') {
      const { findingId } = args;
      if (!findingId) throw new Error('Missing findingId parameter');
      
      console.error(`[MCP] Running compare.js for finding ${findingId}...`);
      
      const { stdout, stderr } = await execPromise(`node compare.js ${findingId}`, { cwd: rootDir });
      
      return {
        content: [
          {
            type: 'text',
            text: `Compare completed.\n\nOutput:\n${stdout}`,
          },
        ],
      };
    }

    if (name === 'get_action_tasks') {
      const { auditId } = args;
      if (!auditId) throw new Error('Missing auditId parameter');
      
      const db = initDb();
      const audit = db.prepare('SELECT ai_tasks FROM audits WHERE id = ?').get(auditId);
      
      if (!audit || !audit.ai_tasks) {
        return {
          content: [ { type: 'text', text: '[]' } ]
        };
      }
      return {
        content: [ { type: 'text', text: audit.ai_tasks } ]
      };
    }

    if (name === 'update_action_task') {
      const { auditId, taskId, status, agentNotes } = args;
      if (!auditId || !taskId) throw new Error('Missing parameters');
      
      const db = initDb();
      const audit = db.prepare('SELECT ai_tasks FROM audits WHERE id = ?').get(auditId);
      
      if (!audit || !audit.ai_tasks) {
        throw new Error('Audit or tasks not found');
      }
      
      const tasks = JSON.parse(audit.ai_tasks);
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      
      if (taskIndex === -1) {
        throw new Error('Task ID not found in this audit');
      }
      
      tasks[taskIndex].status = status;
      tasks[taskIndex].agentNotes = agentNotes;
      
      db.prepare('UPDATE audits SET ai_tasks = ? WHERE id = ?').run(JSON.stringify(tasks), auditId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Task ${taskId} updated successfully.\nNew Status: ${status}\nAgent Notes: ${agentNotes}`
          }
        ]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    console.error('[MCP] Error executing tool:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error.message}\n${error.stderr || ''}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Site-Audit MCP Server running on stdio');
}

run().catch((err) => {
  console.error('[MCP] Fatal error running server:', err);
  process.exit(1);
});

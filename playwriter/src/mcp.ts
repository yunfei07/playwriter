import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Prevent Buffers from dumping hex bytes in util.inspect output.
// Without this, returning a screenshot Buffer would log ~400+ chars of useless hex.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import dedent from 'string-dedent'
import { LOG_FILE_PATH, VERSION, parseRelayHost } from './utils.js'
import { ensureRelayServer, RELAY_PORT } from './relay-client.js'
import { PlaywrightExecutor, CodeExecutionTimeoutError } from './executor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Single executor instance for MCP (created lazily)
let executor: PlaywrightExecutor | null = null

interface RemoteConfig {
  host: string
  port: number
  token?: string
}

function getRemoteConfig(): RemoteConfig | null {
  const host = process.env.PLAYWRITER_HOST
  if (!host) {
    return null
  }
  return {
    host,
    port: RELAY_PORT,
    token: process.env.PLAYWRITER_TOKEN,
  }
}

function getLogServerUrl(): string {
  const remote = getRemoteConfig()
  if (remote) {
    const { httpBaseUrl } = parseRelayHost(remote.host, remote.port)
    return `${httpBaseUrl}/mcp-log`
  }
  return `http://127.0.0.1:${RELAY_PORT}/mcp-log`
}

async function sendLogToRelayServer(level: string, ...args: any[]) {
  try {
    await fetch(getLogServerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, args }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // Silently fail if relay server is not available
  }
}

/**
 * Log to both console.error (for early startup) and relay server log file.
 * Fire-and-forget to avoid blocking.
 */
function mcpLog(...args: any[]) {
  console.error(...args)
  sendLogToRelayServer('log', ...args)
}

/** MCP-specific logger for executor */
const mcpLogger = {
  log: (...args: any[]) => mcpLog(...args),
  error: (...args: any[]) => {
    console.error(...args)
    sendLogToRelayServer('error', ...args)
  },
}

async function ensureRelayServerForMcp(): Promise<void> {
  await ensureRelayServer({ logger: mcpLogger })
}

async function getOrCreateExecutor(): Promise<PlaywrightExecutor> {
  if (executor) {
    return executor
  }

  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServerForMcp()
  }

  // Pass config instead of pre-generated URL so executor can generate unique URLs for each connection
  const cdpConfig = remote || { port: RELAY_PORT }
  executor = new PlaywrightExecutor({
    cdpConfig,
    logger: mcpLogger,
    cwd: process.cwd(),
  })

  return executor
}

async function checkRemoteServer({ host, port }: { host: string; port: number }): Promise<void> {
  const { httpBaseUrl } = parseRelayHost(host, port)
  const versionUrl = `${httpBaseUrl}/version`
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }
  } catch (error: any) {
    const isConnectionError = error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError'
    if (isConnectionError) {
      throw new Error(
        `Cannot connect to remote relay server at ${host}. ` +
          `Make sure 'npx -y playwriter serve' is running on the host machine.`,
      )
    }
    throw new Error(`Failed to connect to remote relay server: ${error.message}`)
  }
}

const server = new McpServer({
  name: 'playwriter',
  title: 'The better playwright MCP: works as a browser extension. No context bloat. More capable.',
  version: VERSION,
})

const promptContent =
  fs.readFileSync(path.join(__dirname, '..', 'dist', 'prompt.md'), 'utf-8') +
  `\n\nfor debugging internal playwriter errors, check playwriter relay server logs at: ${LOG_FILE_PATH}`

server.resource(
  'debugger-api',
  'https://playwriter.dev/resources/debugger-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('playwriter/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'debugger-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/debugger-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'editor-api',
  'https://playwriter.dev/resources/editor-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('playwriter/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'editor-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/editor-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'styles-api',
  'https://playwriter.dev/resources/styles-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('playwriter/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'styles-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/styles-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(10000).describe('Timeout in milliseconds for code execution (default: 10000ms)'),
  },
  async ({ code, timeout }) => {
    try {
      // Check relay server on every execute to auto-recover from crashes
      const remote = getRemoteConfig()
      if (!remote) {
        await ensureRelayServerForMcp()
      }

      const exec = await getOrCreateExecutor()
      const result = await exec.execute(code, timeout)

      // Transform executor result to MCP format
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: result.text },
      ]

      for (const image of result.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }

      if (result.isError) {
        return { content, isError: true }
      }

      return { content }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError =
        error instanceof CodeExecutionTimeoutError || error?.name === 'TimeoutError' || error?.name === 'AbortError'

      console.error('Error in execute tool:', errorStack)
      if (!isTimeoutError) {
        sendLogToRelayServer('error', 'Error in execute tool:', errorStack)
      }

      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'

      // timeout stacks are internal noise (Promise.race / setTimeout); only show the message
      const errorText = isTimeoutError ? error.message : errorStack
      return {
        content: [{ type: 'text', text: `Error executing code: ${errorText}${resetHint}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'export_python_test',
  dedent`
    Export the recorded testBuilder scenario for this MCP session as a runnable Python Playwright regression test project.

    This tool requires previous execute calls that use:
    - testBuilder.start(...)
    - testBuilder.step(...)
    - testBuilder.assert(...)

    Export is explicit by design: it never auto-generates tests unless this tool is called.
  `,
  {
    outDir: z
      .string()
      .optional()
      .describe('Output directory. Relative paths resolve from current working directory. Default: ./generated-regression'),
    testName: z
      .string()
      .optional()
      .describe('Test name used for generated file/function names. Default: scenario name from testBuilder.start'),
  },
  async ({ outDir, testName }) => {
    try {
      const exec = await getOrCreateExecutor()
      const exported = exec.exportPythonTest({ outDir, testName })

      return {
        content: [
          {
            type: 'text',
            text:
              `Python regression test exported.\n` +
              `outDir: ${exported.outDir}\n` +
              `testFilePath: ${exported.testFilePath}\n` +
              `requirementsPath: ${exported.requirementsPath}\n` +
              `readmePath: ${exported.readmePath}\n` +
              `stepCount: ${exported.stepCount}\n` +
              `scenarioName: ${exported.scenarioName}\n` +
              `testName: ${exported.testName}`,
          },
        ],
      }
    } catch (error: any) {
      const message = error?.message || String(error)
      return {
        content: [{ type: 'text', text: `Failed to export python test: ${message}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'configure_json_testcase_batch_defaults',
  dedent`
    Configure default arguments for run_json_testcase_batch in this MCP session.

    After configuring, run_json_testcase_batch can omit repeated arguments and only pass batchIndex when needed.
    - Defaults are stored in-memory for this MCP session.
    - Set reset=true to clear all saved defaults.
  `,
  {
    jsonPath: z
      .string()
      .optional()
      .describe('Default testcase JSON path. Relative paths resolve from current working directory.'),
    outDir: z.string().optional().describe('Default output root directory.'),
    batchSize: z.number().int().positive().optional().describe('Default batch size.'),
    batchIndex: z.number().int().min(0).optional().describe('Default batch index.'),
    reset: z.boolean().default(false).describe('Reset all existing defaults before applying provided values.'),
  },
  async ({ jsonPath, outDir, batchSize, batchIndex, reset }) => {
    try {
      const exec = await getOrCreateExecutor()
      const defaults = exec.configureJsonTestcaseBatchDefaults({
        jsonPath,
        outDir,
        batchSize,
        batchIndex,
        reset,
      })

      return {
        content: [
          {
            type: 'text',
            text:
              `JSON batch defaults updated.\n` +
              `jsonPath: ${defaults.jsonPath || '(unset)'}\n` +
              `outDir: ${defaults.outDir || '(unset)'}\n` +
              `batchSize: ${defaults.batchSize ?? '(unset -> 10)'}\n` +
              `batchIndex: ${defaults.batchIndex ?? '(unset -> 0)'}`,
          },
        ],
      }
    } catch (error: any) {
      const message = error?.message || String(error)
      return {
        content: [{ type: 'text', text: `Failed to configure json batch defaults: ${message}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'run_json_testcase_batch',
  dedent`
    Execute and export a batch of JSON testcases (default 10 cases per batch).

    Expected JSON format:
    - Array of cases: [ { id?, name?, baseUrl?, steps: [...] } ]
    - Or object wrapper: { "cases": [ ... ] }

    Supported step actions:
    - goto, click, fill, press, check, uncheck, select
    - assert-url, assert-visible, assert-text

    Behavior:
    - Runs each testcase independently in its own page
    - Continues when one testcase fails (record-and-continue)
    - Exports one Python file per testcase into:
      <outDir>/<json-file-name>/tests/test_<id-or-name-or-index>.py
  `,
  {
    jsonPath: z
      .string()
      .optional()
      .describe('Path to JSON testcase file. Optional if configured via configure_json_testcase_batch_defaults.'),
    outDir: z
      .string()
      .optional()
      .describe('Root output directory. Uses configured default, otherwise ./generated-regression.'),
    batchSize: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('How many testcases to process in this call. Uses configured default, otherwise 10.'),
    batchIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Zero-based batch index. Uses configured default, otherwise 0.'),
  },
  async ({ jsonPath, outDir, batchSize, batchIndex }) => {
    try {
      const exec = await getOrCreateExecutor()
      const result = await exec.runJsonTestcaseBatch({
        jsonPath,
        outDir,
        batchSize,
        batchIndex,
      })

      const lines = result.results.map((item) => {
        const label = item.status === 'passed' ? 'PASS' : 'FAIL'
        const caseLabel = item.caseId || item.caseName || `case-${item.caseIndex + 1}`
        const detail = item.status === 'passed' ? item.testFilePath || '' : item.error || ''
        return `- [${label}] #${item.caseIndex + 1} (${caseLabel}) ${detail}`
      })

      return {
        content: [
          {
            type: 'text',
            text:
              `JSON testcase batch finished.\n` +
              `jsonPath: ${result.jsonPath}\n` +
              `outDir: ${result.outDir}\n` +
              `batchIndex: ${result.batchIndex}\n` +
              `batchSize: ${result.batchSize}\n` +
              `batchStartIndex: ${result.batchStartIndex}\n` +
              `totalCases: ${result.totalCases}\n` +
              `processedCases: ${result.processedCases}\n` +
              `passedCases: ${result.passedCases}\n` +
              `failedCases: ${result.failedCases}\n` +
              (lines.length > 0 ? `results:\n${lines.join('\n')}` : 'results:\n- (no cases in this batch range)'),
          },
        ],
      }
    } catch (error: any) {
      const message = error?.message || String(error)
      return {
        content: [{ type: 'text', text: `Failed to run json testcase batch: ${message}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, if there are no pages in context, assertion failures, page closed, or other issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    This tools also removes any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.

    if playwright always returns all pages as about:blank urls and evaluate does not work you should ask the user to restart Chrome. This is a known Chrome bug.
  `,
  {},
  async () => {
    try {
      // Check relay server to auto-recover from crashes
      const remote = getRemoteConfig()
      if (!remote) {
        await ensureRelayServerForMcp()
      }

      const exec = await getOrCreateExecutor()
      const { page, context } = await exec.reset()
      const pagesCount = context.pages().length
      return {
        content: [
          {
            type: 'text',
            text: `Connection reset successfully. ${pagesCount} page(s) available. Current page URL: ${page.url()}`,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to reset connection: ${error.message}` }],
        isError: true,
      }
    }
  },
)

export async function startMcp(options: { host?: string; token?: string } = {}) {
  if (options.host) {
    process.env.PLAYWRITER_HOST = options.host
  }
  if (options.token) {
    process.env.PLAYWRITER_TOKEN = options.token
  }

  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServerForMcp()
  } else {
    mcpLog(`Using remote CDP relay server: ${remote.host}`)
    await checkRemoteServer(remote)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

import fs from 'node:fs'
import path from 'node:path'

export type RecordedActionStep =
  | { action: 'goto'; url: string }
  | { action: 'click'; locator: string }
  | { action: 'fill'; locator: string; value: string }
  | { action: 'press'; locator: string; key: string }
  | { action: 'check'; locator: string }
  | { action: 'uncheck'; locator: string }
  | { action: 'select'; locator: string; value: string }

export type RecordedAssertionStep =
  | { action: 'assert-url'; expectedUrl: string }
  | { action: 'assert-visible'; locator: string }
  | { action: 'assert-text'; locator: string; expectedText: string }

export type RecordedStep = RecordedActionStep | RecordedAssertionStep

export type AssertionInput =
  | { type: 'url'; expectedUrl: string }
  | { type: 'visible'; locator: string }
  | { type: 'text'; locator: string; expectedText: string }

export interface TestScenario {
  name: string
  baseUrl?: string
  createdAtIso: string
  steps: RecordedStep[]
}

export interface TestBuilderStatus {
  started: boolean
  name: string | null
  baseUrl: string | null
  stepCount: number
  createdAtIso: string | null
}

export interface TestScriptBuilder {
  start(options: { name?: string; baseUrl?: string }): TestBuilderStatus
  step(step: RecordedActionStep): TestBuilderStatus
  assert(assertion: AssertionInput): TestBuilderStatus
  status(): TestBuilderStatus
  reset(): void
  renderPython(options: { testName?: string }): string
}

type WritableFileSystem = {
  mkdirSync(path: string, options?: fs.MakeDirectoryOptions): unknown
  writeFileSync(path: string, data: string, options?: fs.WriteFileOptions): void
}

export interface MaterializedPytestProject {
  outDir: string
  testFilePath: string
  requirementsPath: string
  readmePath: string
  files: string[]
}

const DEFAULT_SCENARIO_NAME = 'playwriter regression'
const DEFAULT_TEST_NAME = 'playwriter-regression'

function normalizeScenarioName(options: { name?: string }): string {
  const trimmed = options.name?.trim()
  if (!trimmed) {
    return DEFAULT_SCENARIO_NAME
  }
  return trimmed
}

function toSlug(options: { value: string }): string {
  return options.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toSnakeCase(options: { value: string }): string {
  return options.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function ensureScenario(options: { scenario: TestScenario | null }): TestScenario {
  if (!options.scenario) {
    throw new Error('No test scenario started. Call testBuilder.start(...) first.')
  }
  return options.scenario
}

function toPythonStringLiteral(options: { value: string }): string {
  const escaped = options.value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `'${escaped}'`
}

function resolveStepUrl(options: { baseUrl?: string; url: string }): string {
  const { baseUrl, url } = options
  if (!baseUrl) {
    return url
  }

  try {
    return new URL(url, baseUrl).toString()
  } catch {
    return url
  }
}

function renderStep(options: { step: RecordedStep; baseUrl?: string }): string {
  const { step, baseUrl } = options

  if (step.action === 'goto') {
    const resolvedUrl = resolveStepUrl({ baseUrl, url: step.url })
    return `page.goto(${toPythonStringLiteral({ value: resolvedUrl })})`
  }

  if (step.action === 'click') {
    return `page.locator(${toPythonStringLiteral({ value: step.locator })}).click()`
  }

  if (step.action === 'fill') {
    return `page.locator(${toPythonStringLiteral({ value: step.locator })}).fill(${toPythonStringLiteral({ value: step.value })})`
  }

  if (step.action === 'press') {
    return `page.locator(${toPythonStringLiteral({ value: step.locator })}).press(${toPythonStringLiteral({ value: step.key })})`
  }

  if (step.action === 'check') {
    return `page.locator(${toPythonStringLiteral({ value: step.locator })}).check()`
  }

  if (step.action === 'uncheck') {
    return `page.locator(${toPythonStringLiteral({ value: step.locator })}).uncheck()`
  }

  if (step.action === 'select') {
    return `page.locator(${toPythonStringLiteral({ value: step.locator })}).select_option(${toPythonStringLiteral({ value: step.value })})`
  }

  if (step.action === 'assert-url') {
    return `expect(page).to_have_url(${toPythonStringLiteral({ value: step.expectedUrl })})`
  }

  if (step.action === 'assert-visible') {
    return `expect(page.locator(${toPythonStringLiteral({ value: step.locator })})).to_be_visible()`
  }

  return `expect(page.locator(${toPythonStringLiteral({ value: step.locator })})).to_contain_text(${toPythonStringLiteral({ value: step.expectedText })})`
}

export function createTestScriptBuilder(): TestScriptBuilder {
  let scenario: TestScenario | null = null

  const getStatus = (): TestBuilderStatus => {
    return {
      started: Boolean(scenario),
      name: scenario?.name || null,
      baseUrl: scenario?.baseUrl || null,
      stepCount: scenario?.steps.length || 0,
      createdAtIso: scenario?.createdAtIso || null,
    }
  }

  return {
    start(options: { name?: string; baseUrl?: string }): TestBuilderStatus {
      scenario = {
        name: normalizeScenarioName({ name: options.name }),
        baseUrl: options.baseUrl?.trim() || undefined,
        createdAtIso: new Date().toISOString(),
        steps: [],
      }
      return getStatus()
    },

    step(step: RecordedActionStep): TestBuilderStatus {
      const currentScenario = ensureScenario({ scenario })
      currentScenario.steps.push(step)
      return getStatus()
    },

    assert(assertion: AssertionInput): TestBuilderStatus {
      const currentScenario = ensureScenario({ scenario })

      if (assertion.type === 'url') {
        currentScenario.steps.push({
          action: 'assert-url',
          expectedUrl: assertion.expectedUrl,
        })
        return getStatus()
      }

      if (assertion.type === 'visible') {
        currentScenario.steps.push({
          action: 'assert-visible',
          locator: assertion.locator,
        })
        return getStatus()
      }

      currentScenario.steps.push({
        action: 'assert-text',
        locator: assertion.locator,
        expectedText: assertion.expectedText,
      })
      return getStatus()
    },

    status(): TestBuilderStatus {
      return getStatus()
    },

    reset(): void {
      scenario = null
    },

    renderPython(options: { testName?: string }): string {
      const currentScenario = ensureScenario({ scenario })
      if (currentScenario.steps.length === 0) {
        throw new Error('Cannot export test: scenario has no recorded steps.')
      }

      const normalizedTestName = toSnakeCase({
        value: options.testName || currentScenario.name || DEFAULT_TEST_NAME,
      })
      const safeTestName = normalizedTestName || DEFAULT_TEST_NAME

      const stepLines = currentScenario.steps.map((step) => {
        return `            ${renderStep({ step, baseUrl: currentScenario.baseUrl })}`
      })

      return [
        'from playwright.sync_api import sync_playwright, expect',
        '',
        '',
        `def test_${safeTestName}() -> None:`,
        '    with sync_playwright() as playwright:',
        '        browser = playwright.chromium.launch(headless=False)',
        '        page = browser.new_page()',
        '        try:',
        ...stepLines,
        '        finally:',
        '            browser.close()',
        '',
      ].join('\n')
    },
  }
}

export function materializePytestProject(options: {
  outDir: string
  testName: string
  scriptContent: string
  fileSystem?: WritableFileSystem
}): MaterializedPytestProject {
  const fileSystem = options.fileSystem || fs
  const resolvedOutDir = path.resolve(options.outDir)
  const testsDir = path.join(resolvedOutDir, 'tests')
  const normalizedTestName = toSnakeCase({ value: options.testName }) || DEFAULT_TEST_NAME
  const testFilePath = path.join(testsDir, `test_${normalizedTestName}.py`)
  const requirementsPath = path.join(resolvedOutDir, 'requirements.txt')
  const readmePath = path.join(resolvedOutDir, 'README.md')

  fileSystem.mkdirSync(testsDir, { recursive: true })
  fileSystem.writeFileSync(testFilePath, options.scriptContent.endsWith('\n') ? options.scriptContent : `${options.scriptContent}\n`, {
    encoding: 'utf-8',
  })
  fileSystem.writeFileSync(
    requirementsPath,
    ['pytest>=8.0.0', 'playwright>=1.50.0'].join('\n') + '\n',
    { encoding: 'utf-8' },
  )

  const readmeContent = [
    '# Playwriter Exported Regression Test',
    '',
    '## Setup',
    '',
    '```bash',
    'python -m venv .venv',
    '# macOS/Linux',
    'source .venv/bin/activate',
    '# Windows PowerShell',
    '# .venv\\Scripts\\Activate.ps1',
    'pip install -r requirements.txt',
    'playwright install chromium',
    '```',
    '',
    '## Run',
    '',
    '```bash',
    'pytest -q',
    '```',
    '',
  ].join('\n')
  fileSystem.writeFileSync(readmePath, readmeContent, { encoding: 'utf-8' })

  return {
    outDir: resolvedOutDir,
    testFilePath,
    requirementsPath,
    readmePath,
    files: [testFilePath, requirementsPath, readmePath],
  }
}

export function normalizeDefaultTestName(options: { value: string }): string {
  return toSlug({ value: options.value }) || DEFAULT_TEST_NAME
}

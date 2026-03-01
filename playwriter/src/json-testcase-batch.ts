import path from 'node:path'
import { type RecordedStep } from './test-script-builder.js'

export interface JsonTestcase {
  id?: string
  name?: string
  baseUrl?: string
  steps: RecordedStep[]
}

export interface ParsedJsonTestcaseFile {
  sourcePath: string
  cases: JsonTestcase[]
}

export interface BatchSlice<T> {
  items: T[]
  startIndex: number
}

export interface JsonBatchRunOptions {
  jsonPath?: string
  outDir?: string
  batchSize?: number
  batchIndex?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readOptionalString(options: {
  sourcePath: string
  caseNumber: number
  key: 'id' | 'name' | 'baseUrl'
  value: unknown
}): string | undefined {
  const { sourcePath, caseNumber, key, value } = options
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid testcase file ${sourcePath}: case #${caseNumber} field "${key}" must be a string.`)
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

function parseRecordedStep(options: { sourcePath: string; caseNumber: number; stepNumber: number; step: unknown }): RecordedStep {
  const { sourcePath, caseNumber, stepNumber, step } = options
  if (!isRecord(step)) {
    throw new Error(
      `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} must be an object.`,
    )
  }

  const action = step.action
  if (typeof action !== 'string') {
    throw new Error(
      `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} requires an "action" string.`,
    )
  }

  if (action === 'goto') {
    if (typeof step.url !== 'string' || !step.url.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "goto" requires "url".`,
      )
    }
    return { action: 'goto', url: step.url }
  }

  if (action === 'click') {
    if (typeof step.locator !== 'string' || !step.locator.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "click" requires "locator".`,
      )
    }
    return { action: 'click', locator: step.locator }
  }

  if (action === 'fill') {
    if (typeof step.locator !== 'string' || !step.locator.trim() || typeof step.value !== 'string') {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "fill" requires "locator" and "value".`,
      )
    }
    return { action: 'fill', locator: step.locator, value: step.value }
  }

  if (action === 'press') {
    if (typeof step.locator !== 'string' || !step.locator.trim() || typeof step.key !== 'string' || !step.key.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "press" requires "locator" and "key".`,
      )
    }
    return { action: 'press', locator: step.locator, key: step.key }
  }

  if (action === 'check') {
    if (typeof step.locator !== 'string' || !step.locator.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "check" requires "locator".`,
      )
    }
    return { action: 'check', locator: step.locator }
  }

  if (action === 'uncheck') {
    if (typeof step.locator !== 'string' || !step.locator.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "uncheck" requires "locator".`,
      )
    }
    return { action: 'uncheck', locator: step.locator }
  }

  if (action === 'select') {
    if (typeof step.locator !== 'string' || !step.locator.trim() || typeof step.value !== 'string') {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "select" requires "locator" and "value".`,
      )
    }
    return { action: 'select', locator: step.locator, value: step.value }
  }

  if (action === 'assert-url') {
    if (typeof step.expectedUrl !== 'string' || !step.expectedUrl.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "assert-url" requires "expectedUrl".`,
      )
    }
    return { action: 'assert-url', expectedUrl: step.expectedUrl }
  }

  if (action === 'assert-visible') {
    if (typeof step.locator !== 'string' || !step.locator.trim()) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "assert-visible" requires "locator".`,
      )
    }
    return { action: 'assert-visible', locator: step.locator }
  }

  if (action === 'assert-text') {
    if (
      typeof step.locator !== 'string' ||
      !step.locator.trim() ||
      typeof step.expectedText !== 'string'
    ) {
      throw new Error(
        `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} action "assert-text" requires "locator" and "expectedText".`,
      )
    }
    return { action: 'assert-text', locator: step.locator, expectedText: step.expectedText }
  }

  throw new Error(
    `Invalid testcase file ${sourcePath}: case #${caseNumber} step #${stepNumber} has unsupported action "${action}".`,
  )
}

export function parseJsonTestcaseFile(options: { sourcePath: string; content: string }): ParsedJsonTestcaseFile {
  const { sourcePath, content } = options
  const parsedValue: unknown = (() => {
    try {
      return JSON.parse(content)
    } catch (error) {
      throw new Error(`Invalid testcase file ${sourcePath}: not valid JSON.`, { cause: error })
    }
  })()

  const rawCases: unknown = (() => {
    if (Array.isArray(parsedValue)) {
      return parsedValue
    }
    if (isRecord(parsedValue) && Array.isArray(parsedValue.cases)) {
      return parsedValue.cases
    }
    return null
  })()

  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error(
      `Invalid testcase file ${sourcePath}: expected a non-empty array or { "cases": [...] } object.`,
    )
  }

  const cases = rawCases.map((item, index) => {
    const caseNumber = index + 1
    if (!isRecord(item)) {
      throw new Error(`Invalid testcase file ${sourcePath}: case #${caseNumber} must be an object.`)
    }

    const rawSteps = item.steps
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      throw new Error(`Invalid testcase file ${sourcePath}: case #${caseNumber} must include a non-empty "steps" array.`)
    }

    const steps = rawSteps.map((step, stepIndex) => {
      return parseRecordedStep({
        sourcePath,
        caseNumber,
        stepNumber: stepIndex + 1,
        step,
      })
    })

    const id = readOptionalString({
      sourcePath,
      caseNumber,
      key: 'id',
      value: item.id,
    })
    const name = readOptionalString({
      sourcePath,
      caseNumber,
      key: 'name',
      value: item.name,
    })
    const baseUrl = readOptionalString({
      sourcePath,
      caseNumber,
      key: 'baseUrl',
      value: item.baseUrl,
    })

    return {
      id,
      name,
      baseUrl,
      steps,
    }
  })

  return {
    sourcePath,
    cases,
  }
}

export function resolveBatchSlice<T>(options: { cases: T[]; batchSize?: number; batchIndex?: number }): BatchSlice<T> {
  const total = options.cases.length
  const normalizedBatchSize = (() => {
    const value = options.batchSize ?? 10
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('batchSize must be a positive integer.')
    }
    return value
  })()
  const normalizedBatchIndex = (() => {
    const value = options.batchIndex ?? 0
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('batchIndex must be an integer >= 0.')
    }
    return value
  })()

  const startIndex = normalizedBatchIndex * normalizedBatchSize
  if (startIndex >= total) {
    return {
      items: [],
      startIndex,
    }
  }

  return {
    items: options.cases.slice(startIndex, startIndex + normalizedBatchSize),
    startIndex,
  }
}

function readValidatedBatchSize(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('batchSize must be a positive integer.')
  }
  return value
}

function readValidatedBatchIndex(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('batchIndex must be an integer >= 0.')
  }
  return value
}

function readNormalizedString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function mergeJsonBatchRunOptions(options: {
  defaults?: JsonBatchRunOptions
  overrides?: JsonBatchRunOptions
}): Required<Pick<JsonBatchRunOptions, 'jsonPath' | 'batchSize' | 'batchIndex'>> &
  Pick<JsonBatchRunOptions, 'outDir'> {
  const merged: JsonBatchRunOptions = {
    jsonPath: readNormalizedString(options.overrides?.jsonPath) || readNormalizedString(options.defaults?.jsonPath),
    outDir: readNormalizedString(options.overrides?.outDir) || readNormalizedString(options.defaults?.outDir),
    batchSize: options.overrides?.batchSize ?? options.defaults?.batchSize ?? 10,
    batchIndex: options.overrides?.batchIndex ?? options.defaults?.batchIndex ?? 0,
  }

  const jsonPath = readNormalizedString(merged.jsonPath)
  if (!jsonPath) {
    throw new Error('jsonPath is required.')
  }

  const batchSize = readValidatedBatchSize(merged.batchSize)
  const batchIndex = readValidatedBatchIndex(merged.batchIndex)

  if (batchSize === undefined || batchIndex === undefined) {
    throw new Error('Internal error: missing batch options.')
  }

  return {
    jsonPath,
    outDir: merged.outDir,
    batchSize,
    batchIndex,
  }
}

export function resolveCaseTestName(options: { testCase: Pick<JsonTestcase, 'id' | 'name'>; caseIndex: number }): string {
  const caseId = options.testCase.id?.trim()
  if (caseId) {
    return caseId
  }

  const caseName = options.testCase.name?.trim()
  if (caseName) {
    return caseName
  }

  return `case-${options.caseIndex + 1}`
}

export function resolveGroupedOutDir(options: { cwd: string; jsonPath: string; outDir?: string }): string {
  const rootOutDir = (() => {
    if (!options.outDir) {
      return path.resolve(options.cwd, 'generated-regression')
    }

    if (path.isAbsolute(options.outDir)) {
      return options.outDir
    }

    return path.resolve(options.cwd, options.outDir)
  })()

  const groupName = path.basename(options.jsonPath, path.extname(options.jsonPath)) || 'cases'
  return path.join(rootOutDir, groupName)
}

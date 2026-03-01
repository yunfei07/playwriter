import { describe, expect, test } from 'vitest'
import path from 'node:path'
import {
  mergeJsonBatchRunOptions,
  parseJsonTestcaseFile,
  resolveBatchSlice,
  resolveGroupedOutDir,
  resolveCaseTestName,
} from './json-testcase-batch.js'

describe('json-testcase-batch', () => {
  test('parses array testcase files', () => {
    const parsed = parseJsonTestcaseFile({
      sourcePath: '/repo/cases/google.json',
      content: JSON.stringify([
        {
          id: 'google_openclaw_001',
          name: 'Google search openclaw',
          baseUrl: 'https://www.google.com',
          steps: [
            { action: 'goto', url: '/' },
            { action: 'fill', locator: 'textarea[name="q"]', value: 'openclaw' },
            { action: 'press', locator: 'textarea[name="q"]', key: 'Enter' },
            { action: 'assert-visible', locator: 'a[href*="openclaw"]' },
          ],
        },
      ]),
    })

    expect(parsed.cases).toHaveLength(1)
    expect(parsed.cases[0]?.id).toBe('google_openclaw_001')
    expect(parsed.cases[0]?.steps).toHaveLength(4)
  })

  test('parses object testcase files with cases field', () => {
    const parsed = parseJsonTestcaseFile({
      sourcePath: '/repo/cases/order.json',
      content: JSON.stringify({
        cases: [
          {
            id: 'order_001',
            steps: [{ action: 'goto', url: 'https://example.com' }],
          },
        ],
      }),
    })

    expect(parsed.cases).toHaveLength(1)
    expect(parsed.cases[0]?.id).toBe('order_001')
  })

  test('throws when steps are missing', () => {
    expect(() => {
      parseJsonTestcaseFile({
        sourcePath: '/repo/cases/bad.json',
        content: JSON.stringify([{ id: 'bad_case' }]),
      })
    }).toThrowErrorMatchingInlineSnapshot(
      '[Error: Invalid testcase file /repo/cases/bad.json: case #1 must include a non-empty "steps" array.]',
    )
  })

  test('returns deterministic 10-case batches', () => {
    const input: Array<{ id: string; steps: Array<{ action: "goto"; url: string }> }> = Array.from(
      { length: 25 },
      (_, index) => {
        return {
          id: `case_${index + 1}`,
          steps: [{ action: 'goto', url: `https://example.com/${index + 1}` }],
        }
      },
    )

    const firstBatch = resolveBatchSlice({
      cases: input,
      batchSize: 10,
      batchIndex: 0,
    })
    expect(firstBatch.items).toHaveLength(10)
    expect(firstBatch.startIndex).toBe(0)

    const secondBatch = resolveBatchSlice({
      cases: input,
      batchSize: 10,
      batchIndex: 1,
    })
    expect(secondBatch.items).toHaveLength(10)
    expect(secondBatch.startIndex).toBe(10)

    const thirdBatch = resolveBatchSlice({
      cases: input,
      batchSize: 10,
      batchIndex: 2,
    })
    expect(thirdBatch.items).toHaveLength(5)
    expect(thirdBatch.startIndex).toBe(20)
  })

  test('groups output by json filename', () => {
    const resolved = resolveGroupedOutDir({
      cwd: '/repo',
      jsonPath: '/repo/cases/order.json',
      outDir: './generated-regression',
    })

    expect(resolved).toBe(path.resolve('/repo/generated-regression/order'))
  })

  test('uses testcase id for exported filename stem and falls back when missing', () => {
    expect(resolveCaseTestName({ testCase: { id: 'tc_001' }, caseIndex: 0 })).toBe('tc_001')
    expect(resolveCaseTestName({ testCase: { name: 'search smoke' }, caseIndex: 1 })).toBe('search smoke')
    expect(resolveCaseTestName({ testCase: {}, caseIndex: 2 })).toBe('case-3')
  })

  test('merges run options from defaults and call overrides', () => {
    const merged = mergeJsonBatchRunOptions({
      defaults: {
        jsonPath: './cases/order.json',
        outDir: './generated-regression',
        batchSize: 10,
        batchIndex: 0,
      },
      overrides: {
        batchIndex: 2,
      },
    })

    expect(merged).toEqual({
      jsonPath: './cases/order.json',
      outDir: './generated-regression',
      batchSize: 10,
      batchIndex: 2,
    })
  })

  test('throws when merged options still miss jsonPath', () => {
    expect(() => {
      mergeJsonBatchRunOptions({
        defaults: {
          batchSize: 10,
          batchIndex: 0,
        },
        overrides: {
          batchIndex: 1,
        },
      })
    }).toThrowErrorMatchingInlineSnapshot(`[Error: jsonPath is required.]`)
  })
})

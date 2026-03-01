import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createTestScriptBuilder, materializePytestProject } from './test-script-builder.js'

describe('test-script-builder', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp', 'test-script-builder')

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  test('renders pytest sync script from recorded steps', () => {
    const builder = createTestScriptBuilder()

    builder.start({
      name: 'example login flow',
      baseUrl: 'https://example.com',
    })
    builder.step({ action: 'goto', url: '/login' })
    builder.step({ action: 'fill', locator: '#email', value: 'user@example.com' })
    builder.step({ action: 'fill', locator: '#password', value: 'secret' })
    builder.step({ action: 'click', locator: 'button[type="submit"]' })
    builder.assert({ type: 'url', expectedUrl: 'https://example.com/dashboard' })
    builder.assert({ type: 'visible', locator: 'h1' })
    builder.assert({ type: 'text', locator: 'h1', expectedText: 'Dashboard' })

    const rendered = builder.renderPython({
      testName: 'example-login-flow',
    })

    expect(rendered).toMatchInlineSnapshot(`
      "from playwright.sync_api import sync_playwright, expect


      def test_example_login_flow() -> None:
          with sync_playwright() as playwright:
              browser = playwright.chromium.launch(headless=False)
              page = browser.new_page()
              try:
                  page.goto('https://example.com/login')
                  page.locator('#email').fill('user@example.com')
                  page.locator('#password').fill('secret')
                  page.locator('button[type="submit"]').click()
                  expect(page).to_have_url('https://example.com/dashboard')
                  expect(page.locator('h1')).to_be_visible()
                  expect(page.locator('h1')).to_contain_text('Dashboard')
              finally:
                  browser.close()
      "
    `)
  })

  test('throws when exporting without steps', () => {
    const builder = createTestScriptBuilder()
    builder.start({ name: 'empty scenario' })

    expect(() => {
      builder.renderPython({ testName: 'empty' })
    }).toThrowErrorMatchingInlineSnapshot(`[Error: Cannot export test: scenario has no recorded steps.]`)
  })

  test('materializes a runnable pytest project', () => {
    const builder = createTestScriptBuilder()
    builder.start({
      name: 'materialize flow',
      baseUrl: 'https://example.com',
    })
    builder.step({ action: 'goto', url: '/' })
    builder.assert({ type: 'visible', locator: 'h1' })

    const rendered = builder.renderPython({ testName: 'materialize-flow' })
    const materialized = materializePytestProject({
      outDir: tmpRoot,
      testName: 'materialize-flow',
      scriptContent: rendered,
    })

    expect(materialized).toMatchInlineSnapshot(`
      {
        "files": [
          "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder/tests/test_materialize_flow.py",
          "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder/requirements.txt",
          "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder/README.md",
        ],
        "outDir": "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder",
        "readmePath": "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder/README.md",
        "requirementsPath": "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder/requirements.txt",
        "testFilePath": "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/tmp/test-script-builder/tests/test_materialize_flow.py",
      }
    `)

    expect(fs.existsSync(path.join(tmpRoot, 'tests', 'test_materialize_flow.py'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'requirements.txt'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'README.md'))).toBe(true)
  })
})

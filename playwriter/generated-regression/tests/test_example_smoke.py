from playwright.sync_api import sync_playwright, expect


def test_example_smoke() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        page = browser.new_page()
        try:
            page.goto('https://baidu.com/')
            page.locator('a').click()
            expect(page).to_have_url('https://www.iana.org/help/example-domains')
        finally:
            browser.close()

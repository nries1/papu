"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Full dry-run: login → navigate to date → find class → navigate to reservation page → verify button present
// Does NOT actually click "Make a single reservation"
const playwright_1 = require("playwright");
const MAINCLASS = 'https://clients.mindbodyonline.com/classic/mainclass?studioid=140321';
async function debug() {
    const browser = await playwright_1.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    try {
        // === LOGIN ===
        await page.goto(MAINCLASS);
        await page.waitForLoadState('load');
        await page.waitForTimeout(1500);
        console.log(`[1] ${page.url()}`);
        if (page.url().includes('extLink') || await page.locator('#btnSignIn').isVisible()) {
            await Promise.all([
                page.waitForURL('**/signin.mindbodyonline.com/**', { timeout: 15000 }),
                page.locator('#btnSignIn').click({ force: true }),
            ]);
            await page.waitForLoadState('load');
            await page.locator('#username').fill(process.env.MINDBODY_USERNAME ?? '');
            await Promise.all([
                page.waitForURL('**/signin.mindbodyonline.com/signin/consumer**', { timeout: 15000 }),
                page.locator('button[type="submit"]').click(),
            ]);
            await page.waitForLoadState('load');
            await page.locator('#password').fill(process.env.MINDBODY_PASSWORD ?? '');
            await Promise.all([
                page.waitForURL('**/clients.mindbodyonline.com/classic/**', { timeout: 20000 }),
                page.locator('button[type="submit"]').click(),
            ]);
            await page.waitForLoadState('load');
        }
        console.log(`[2 logged in] ${page.url()}`);
        console.log(`  btnSignIn visible: ${await page.locator('#btnSignIn').isVisible()}`);
        // === NAVIGATE TO DATE ===
        // July 2, 2026 — more than 24h away from July 1
        const [year, month, day] = '2026-07-02'.split('-');
        const mbDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        await page.goto(`${MAINCLASS}&stype=-7&view=day&date=${mbDate}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);
        console.log(`[3 date nav] ${page.url()}`);
        // === FIND CLASS ===
        const entries = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('input[type="button"][name^="but"]'));
            return btns.map((btn) => {
                const onclick = btn.getAttribute('onclick') || '';
                const urlMatch = onclick.match(/document\.location='([^']+)'/);
                const bookingPath = urlMatch ? urlMatch[1] : '';
                let ancestorText = '';
                let node = btn;
                for (let i = 0; i < 20; i++) {
                    node = node?.parentElement || null;
                    if (!node)
                        break;
                    const txt = (node.textContent || '').trim();
                    if (txt.length > 30 && txt.length < 500) {
                        ancestorText = txt.replace(/\s+/g, ' ');
                        break;
                    }
                }
                return { bookingPath, ancestorText };
            }).filter((e) => e.bookingPath);
        });
        console.log(`\n[4] Found ${entries.length} sign-up entries:`);
        entries.forEach((e, i) => console.log(`  [${i}] path="${e.bookingPath}" text="${e.ancestorText.slice(0, 70)}"`));
        // Find WeFlowHard
        const target = entries.find(e => /weflow/i.test(e.ancestorText));
        if (!target) {
            console.log('No WeFlowHard found!');
            return;
        }
        console.log(`\n[5] Targeting: ${target.ancestorText.slice(0, 80)}`);
        // === NAVIGATE TO RESERVATION PAGE ===
        await page.goto(`https://clients.mindbodyonline.com${target.bookingPath}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(1000);
        console.log(`[6 reservation] ${page.url()}`);
        const resBody = await page.locator('body').innerText();
        const hasAlreadyEnrolled = /you are enrolled|already signed up|already enrolled/i.test(resBody);
        const singleBtnVisible = await page.locator('#SubmitEnroll2').isVisible().catch(() => false);
        console.log(`  Already enrolled: ${hasAlreadyEnrolled}`);
        console.log(`  #SubmitEnroll2 visible: ${singleBtnVisible}`);
        console.log(`  Reservation body (first 300):\n${resBody.slice(0, 300)}`);
        if (hasAlreadyEnrolled) {
            console.log(`\nResult: Already booked`);
        }
        else if (singleBtnVisible) {
            console.log(`\nResult: Ready to book — would click #SubmitEnroll2 ("Make a single reservation")`);
            console.log(`  (DRY RUN — not clicking)`);
        }
    }
    catch (err) {
        console.error('\nERROR:', err instanceof Error ? err.message : String(err));
        await page.screenshot({ path: '/app/dist/debug-error.png' }).catch(() => { });
    }
    finally {
        await context.close();
        await browser.close();
    }
}
debug();

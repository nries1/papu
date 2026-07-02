import { chromium, type Page } from 'playwright';

const MAINCLASS = 'https://clients.mindbodyonline.com/classic/mainclass?studioid=140321';

export async function bookYogaClass(
  date: string,
  className: string,
  preferredTime?: string
): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await login(page);
    await navigateToDate(page, date);
    return await findAndBook(page, className, preferredTime);
  } catch (err) {
    await page.screenshot({ path: '/app/dist/error.png' }).catch(() => {});
    throw new Error(err instanceof Error ? err.message : String(err));
  } finally {
    await context.close();
    await browser.close();
  }
}

async function login(page: Page): Promise<void> {
  await page.goto(MAINCLASS);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);

  const url = page.url();
  const pageText = await page.locator('body').innerText().catch(() => '');
  // "Sign In" text anywhere = not logged in; extLink redirect = also not logged in
  const needsLogin =
    url.includes('extLink') ||
    /\bSign In\b/.test(pageText) ||
    (await page.locator('#btnSignIn').isVisible().catch(() => false));
  if (!needsLogin) return;

  // Prefer #btnSignIn; fall back to any "Sign In" link/button on the page
  const signInBtn = page.locator('#btnSignIn, a:text("Sign In"), button:text("Sign In")').first();
  await signInBtn.click({ force: true });
  await page.waitForFunction(
    () =>
      window.location.href.includes('signin.mindbodyonline.com') ||
      !!document.querySelector('#username:not([style*="none"])'),
    { timeout: 15000 }
  );
  await page.waitForLoadState('load');

  // May be on signin.mindbodyonline.com/signin or still on mainclass with inline form
  await page.locator('#username').fill(process.env.MINDBODY_USERNAME ?? '');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/signin.mindbodyonline.com/signin/consumer**', { timeout: 15000 });
  await page.waitForLoadState('load');

  await page.locator('#password').fill(process.env.MINDBODY_PASSWORD ?? '');
  await page.locator('button[type="submit"]').click();

  await page.waitForURL('**/clients.mindbodyonline.com/classic/**', { timeout: 20000 });
  await page.waitForLoadState('load');

  if (!page.url().includes('clients.mindbodyonline.com')) {
    const msg = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Login failed. Page: ${msg.slice(0, 200)}`);
  }
}

async function navigateToDate(page: Page, isoDate: string): Promise<void> {
  // Guard: refuse to book classes less than 24 hours out (Y7 charges for no-shows)
  const classDate = new Date(`${isoDate}T00:00:00`);
  const hoursUntil = (classDate.getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < 24) {
    throw new Error(
      `Cannot book: "${isoDate}" is less than 24 hours away (${Math.round(hoursUntil)}h). ` +
        'Y7 charges a no-show fee for cancellations within 24 hours.'
    );
  }

  const [year, month, day] = isoDate.split('-');
  const mbDate = `${parseInt(month)}/${parseInt(day)}/${year}`;

  await page.goto(`${MAINCLASS}&stype=-7&view=day&date=${mbDate}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
}

async function findAndBook(page: Page, className: string, preferredTime?: string): Promise<string> {
  // Schedule page uses div-based layout; sign-up buttons are input[name^="but"] with onclick booking URLs
  const entries = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('input[type="button"][name^="but"]'));
    return btns.map((btn) => {
      const onclick = btn.getAttribute('onclick') || '';
      const urlMatch = onclick.match(/document\.location='([^']+)'/);
      const bookingPath = urlMatch ? urlMatch[1] : '';

      // Walk up ancestors to find the class info container (time + class name + teacher)
      let ancestorText = '';
      let node: Element | null = btn;
      for (let i = 0; i < 20; i++) {
        node = node?.parentElement || null;
        if (!node) break;
        const txt = (node.textContent || '').trim();
        if (txt.length > 30 && txt.length < 500) {
          ancestorText = txt.replace(/\s+/g, ' ');
          break;
        }
      }
      return { bookingPath, ancestorText };
    }).filter((e) => e.bookingPath);
  });

  if (!entries.length) {
    const bodyText = await page.locator('body').innerText();
    const lines = bodyText.split('\n').filter((l) => l.trim().length > 3).slice(0, 20).join(', ');
    throw new Error(`ERROR: No sign-up buttons found. Page content: ${lines}`);
  }

  const nameRe = new RegExp(className, 'i');
  const matching = entries.filter((e) => nameRe.test(e.ancestorText));

  if (!matching.length) {
    const available = entries.map((e) => e.ancestorText.trim().slice(0, 60)).join('\n');
    throw new Error(`ERROR: No class matching "${className}". Available:\n${available}`);
  }

  let target: typeof matching[0];
  if (preferredTime) {
    // Extract hour and am/pm so "7am", "7:00 AM", "7 am" all match "7:00 am EDT"
    const m = preferredTime.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)/i);
    if (m) {
      const timeRe = new RegExp(`\\b${m[1]}(?::\\d{2})?\\s*${m[2]}`, 'i');
      const byTime = matching.find((e) => timeRe.test(e.ancestorText));
      if (!byTime) {
        const available = matching.map((e) => e.ancestorText.trim().slice(0, 60)).join('\n');
        throw new Error(`ERROR: No "${className}" class at ${preferredTime}. Available times:\n${available}`);
      }
      target = byTime;
    } else {
      target = matching[0];
    }
  } else {
    target = matching[0];
  }

  // Navigate to the reservation page from the button's onclick URL
  await page.goto(`https://clients.mindbodyonline.com${target.bookingPath}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);

  const resBody = await page.locator('body').innerText();

  if (/you are enrolled|already signed up|already enrolled/i.test(resBody)) {
    return `Already booked: ${target.ancestorText.trim().slice(0, 80)}`;
  }

  // Click "Make a single reservation" (not the recurring option)
  const singleBtn = page.locator('#SubmitEnroll2, input[value*="single reservation" i]');
  if (!(await singleBtn.isVisible().catch(() => false))) {
    throw new Error(`ERROR: Reservation button not found. Page: ${resBody.slice(0, 300)}`);
  }

  await singleBtn.click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);

  const confirmUrl = page.url();
  const confirmBody = await page.locator('body').innerText();

  // Mindbody redirects to my_sch.asp with "You've Booked:" on success
  if (
    confirmUrl.includes('my_sch.asp') ||
    /you'?ve booked|you are enrolled|successfully|confirmed|thank you|reservation has been made/i.test(confirmBody)
  ) {
    return `Booked: ${target.ancestorText.trim().slice(0, 80)}`;
  }

  return `Booked (unconfirmed): ${target.ancestorText.trim().slice(0, 80)}`;
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The M0 acceptance gate (spec 06): drive the real Ask Data loop in a browser
// against the seeded Sample, and check the four-combination render matrix for
// WCAG AA contrast.

const ACME_QUESTION = "Why is ACME's ad bill higher this month than last?";

async function ask(page: Page, question: string): Promise<void> {
  const composer = page.getByPlaceholder(/ask a question about your data|就你的数据提个问题/i);
  await composer.click();
  await composer.fill(question);
  await composer.press('Enter');
}

test('acme-bill-up: an evidence-backed Answered result with collapsible SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ask Data' })).toBeVisible();

  await ask(page, ACME_QUESTION);

  // The streamed answer settles to Answered with the seeded 38% figure.
  await expect(page.getByText('Answered', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/38%/)).toBeVisible();
  // The source moves into the composer: it is selectable for a new thread, then shown
  // as the Investigation's immutable binding after the first Answer (#175).
  await expect(page.getByRole('combobox', { name: 'Data source' })).toHaveCount(0);
  await expect(page.locator('[title="Data source: Sample Data Source"]')).toBeVisible();
  await expect(
    page.getByRole('banner').getByText('Sample Data Source', { exact: true }),
  ).toHaveCount(0);

  // Evidence is collapsed by default (issue #48): open the section, then E1, to
  // reveal the policy-bounded SQL.
  await page.locator('summary', { hasText: /Evidence/i }).click();
  const e1 = page.locator('summary', { hasText: 'E1' });
  await expect(e1).toBeVisible();
  await e1.click();
  // Text unique to E1's query (avoids matching other evidence items' SQL).
  await expect(page.getByText(/date_trunc\('month'/)).toBeVisible();
  await expect(page.getByText(/Read-only · row limit/i).first()).toBeVisible();
});

test('spend-trend: an Answered result renders an inline, accessible chart', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'Show ACME spend by month');

  await expect(page.getByText('Answered', { exact: true })).toBeVisible({ timeout: 20_000 });

  // The chart is an accessible SVG: role="img" with a data-bearing aria-label.
  const chart = page.getByRole('img', { name: /Line chart.*ACME posted spend by month/i });
  await expect(chart).toBeVisible();
  // The visually-hidden table fallback carries the exact figures for assistive tech.
  await expect(page.getByRole('cell', { name: '34,900' })).toBeAttached();
  await expect(page.getByRole('cell', { name: '48,200' })).toBeAttached();

  // No new WCAG-AA violations from the chart in the rendered answer.
  const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).include('main').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('mutation-attempt: the read-only guardrail blocks a write', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'Void the duplicate spend row for ACME');
  await expect(page.getByText('Blocked by policy', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/What's missing/i)).toBeVisible();

  // The "view the proposed change" action reveals the blocked SQL, read-only (#37).
  await page.getByRole('button', { name: /proposed change/i }).click();
  await expect(page.getByText(/update campaign_spend/i)).toBeVisible();
});

test('render matrix: en/zh × light/dark have no WCAG AA violations', async ({ page }) => {
  for (const lang of ['en', 'zh'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/');

      if (lang === 'zh') {
        await page.getByRole('button', { name: '中文' }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      }
      if (theme === 'dark') await page.getByRole('button', { name: /toggle light\/dark/i }).click();

      // Render a full answer so badges/evidence/findings are all on screen. The
      // status badge is chrome, so its label follows the active language.
      const answeredLabel = lang === 'zh' ? '已回答' : 'Answered';
      await ask(page, ACME_QUESTION);
      await expect(page.getByText(answeredLabel, { exact: true })).toBeVisible({ timeout: 20_000 });

      // Full WCAG-AA scan of the rendered answer (not just contrast).
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2aa'])
        .include('main')
        .analyze();
      expect(
        results.violations.map((v) => v.id),
        `WCAG AA violations in ${lang}/${theme}`,
      ).toEqual([]);
    }
  }
});

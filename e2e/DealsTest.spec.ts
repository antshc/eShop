import { test, expect } from '@playwright/test';

test('shopper opens Deals from the header and sees the 10 cheapest items', async ({ page }) => {
  await page.goto('/');

  const dealsLink = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Deals' });
  await expect(dealsLink).not.toHaveClass(/is-current/);
  await dealsLink.click();

  await expect(page).toHaveURL(/\/deals$/);
  await expect(page.getByRole('heading', { name: 'Deals', level: 1 })).toBeVisible();
  await expect(dealsLink).toHaveClass(/is-current/);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Shop all' })).not.toHaveClass(/is-current/);

  const cards = page.locator('.catalog-product');
  await expect(cards).toHaveCount(10);

  const prices = (await cards.locator('.price').allTextContents())
    .map(text => Number(text.replace(/[^0-9.]/g, '')));
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  await expect(cards.first().locator('.name')).toHaveText('Guardian Blue Chalk Bag');
  await expect(cards.nth(9).locator('.name')).toHaveText('Excursion 20L Daypack');

  await expect(page.locator('.catalog-sort')).toHaveCount(0);
  await expect(page.locator('.catalog-pagination')).toHaveCount(0);

  await cards.first().click();
  await expect(page.getByRole('heading', { name: 'Guardian Blue Chalk Bag' })).toBeVisible();
});

test('Deals link is available on other pages and highlighted only on Deals', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Deals' })).toBeVisible();

  await page.getByRole('link', { name: 'Adventurer GPS Watch' }).click();
  await expect(nav.getByRole('link', { name: 'Deals' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Deals' })).not.toHaveClass(/is-current/);
});

import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { Planning } from '../electron/planning.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/usability-' + Date.now());
const store = new Store(directory);
store.setSettings({
  theme: 'day',
  semanticSearch: false,
  autoConsolidation: false,
  onboardingComplete: true,
});
ensureProfiles(store);
const planning = new Planning(store);
const list = store.all().find((e) => e.kind === 'list');
store.mutate({ kind: 'card', parent: list.id, title: 'No run yet', data: { status: 'queued' } });
const calendar = store.all().find((e) => e.kind === 'calendar');
const today = new Date();
const localDay = new Date(+today - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
await planning.action({
  action: 'calendar-save',
  calendarId: calendar.id,
  title: 'Menu fixture',
  data: {
    timing: {
      start: localDay + 'T09:00',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      repeat: 'none',
    },
    endLocal: localDay + 'T10:00',
    owner: 'user',
    description: 'Preserved event text',
  },
});
planning.close();
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shot = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(150);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    fs.writeFileSync(path.join(directory, name + '.png'), Buffer.from(png, 'base64'));
  };
  const switches = async () => {
    await page.locator('input.toggle-switch:visible').first().waitFor();
    const geometry = await page.locator('input.toggle-switch:visible').evaluateAll((items) =>
      items.map((e) => {
        const r = e.getBoundingClientRect();
        return { width: r.width, height: r.height, label: e.closest('label')?.textContent };
      }),
    );
    assert.ok(geometry.length);
    for (const g of geometry) {
      assert.equal(Math.round(g.width), 42, g.label);
      assert.equal(Math.round(g.height), 24, g.label);
    }
  };
  await page.locator('.sidebar').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page
    .getByRole('button', { name: /No run yet/ })
    .first()
    .click();
  await page.getByRole('button', { name: /Expand Report/ }).click();
  await page
    .locator('.task-report-modal')
    .getByText('No agent report yet.', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.task-report-modal [role=alert]').count(), 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Cognition Matrix', exact: true })
    .click();
  await page.locator('.matrix-preload-control').waitFor();
  await page.keyboard.press('Tab');
  await page.locator('.matrix-preload-control input').focus();
  assert.equal(await page.getByRole('tooltip').count(), 0);
  assert.match(
    await page.locator('.matrix-preload-control small').innerText(),
    /prepare each list/,
  );
  await switches();
  const aligned = await page
    .locator('.matrix-preload-control')
    .evaluate(
      (e) =>
        e.querySelector('input').getBoundingClientRect().right + 8 <=
        e.querySelector('span').getBoundingClientRect().left,
    );
  assert.ok(aligned);
  await shot('matrix-1080');
  await page.getByRole('button', { name: 'Background & automation', exact: true }).click();
  const port = page.getByLabel('Event port', { exact: true });
  await port.fill('3');
  assert.equal(
    await page.evaluate(
      async () => (await window.intelligence.bootstrap()).settings.externalEventsPort,
    ),
    30091,
  );
  await page.getByRole('button', { name: 'Save event port', exact: true }).click();
  await page.getByText('Enter a whole number from 1024 to 65535.', { exact: true }).waitFor();
  await port.fill('31092');
  await page.getByRole('button', { name: 'Save event port', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.externalEventsPort === 31092,
  );
  await port.hover();
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').innerText(), /connection number/);
  await page.locator('.event-connection-help > summary').click();
  await shot('event-help-1080');
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  const backup = await page.locator('.backup-panel').evaluate((e) => {
    const buttons = [...e.querySelectorAll(':scope > button')].map(
      (b) => b.getBoundingClientRect().left,
    );
    const h = e.querySelector('h3').getBoundingClientRect().left;
    const p = getComputedStyle(e.querySelector('p'));
    return { buttons, h, size: p.fontSize, weight: p.fontWeight };
  });
  assert.ok(backup.buttons.every((x) => Math.abs(x - backup.h) < 1));
  assert.equal(backup.size, '12px');
  assert.equal(backup.weight, '400');
  await shot('backup-1080');
  await page.locator('.settings-help-menu > summary').filter({ hasText: 'Help & setup' }).click();
  await page
    .locator('.settings-help-menu')
    .getByRole('button', { name: 'Review setup', exact: true })
    .click();
  await page
    .locator('.onboarding')
    .getByRole('button', { name: 'Start setup', exact: true })
    .click();
  await switches();
  await shot('guide-name-1080');
  for (let i = 0; i < 3; i++)
    await page
      .locator('.onboarding')
      .getByRole('button', { name: i === 1 ? 'Skip for now' : 'Continue', exact: true })
      .click();
  await switches();
  await shot('guide-memory-1080');
  await page.locator('.onboarding').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Review and begin', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close guide', exact: true }).click();
  await page.locator('.onboarding').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Notebooks', exact: true }).click();
  await page.locator('.book-notebook').first().click();
  const select = page.getByRole('button', { name: 'Select notes / chapters', exact: true });
  assert.equal(await select.count(), 0);
  await shot('notebook-1080');
  await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  const entry = page.locator('.calendar-entry-shell').filter({ hasText: 'Menu fixture' }).first();
  await entry.waitFor();
  await page.getByLabel('Calendar view').selectOption('month');
  await page.locator('.calendar-grid.month').waitFor();
  assert.ok(
    await page
      .locator('.calendar-day')
      .first()
      .evaluate(
        (e) =>
          e.querySelector('header b').getBoundingClientRect().right + 4 <=
          e.querySelector(':scope > details > summary').getBoundingClientRect().left,
      ),
  );
  assert.equal(
    await entry.locator('.calendar-entry').evaluate((e) => getComputedStyle(e).paddingRight),
    '34px',
  );
  await page.getByLabel('Calendar view').selectOption('agenda');
  await page.locator('.calendar-agenda').waitFor();
  assert.ok(
    await entry.evaluate((e) => {
      const button = e.querySelector('button').getBoundingClientRect();
      const menu = e.querySelector('summary').getBoundingClientRect();
      return menu.right <= button.right && menu.left > button.right - 50;
    }),
  );
  await page.getByLabel('Calendar view').selectOption('week');
  await page.locator('.calendar-grid.week').waitFor();
  await entry.click({ button: 'right' });
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  assert.equal(await page.getByLabel('Event title').inputValue(), 'Menu fixture');
  await page.keyboard.press('Escape');
  if (await page.locator('.event-reader').count()) await page.keyboard.press('Escape');
  const day = page.locator('.calendar-day').nth(2);
  const dayNumber = await day.locator('header b').innerText();
  await day.locator('header').click({ button: 'right' });
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'New event', exact: true })
    .click();
  assert.equal(
    Number((await page.getByLabel('Starting date & time').inputValue()).slice(8, 10)),
    Number(dayNumber),
  );
  await page.keyboard.press('Escape');
  await entry.click({ button: 'right' });
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await entry.waitFor({ state: 'detached' });
  await page.locator('.calendar-page h1').click({ button: 'right' });
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'Today', exact: true })
    .click();
  await shot('calendar-1080');
  for (const [w, h] of [
    [2560, 1440],
    [1366, 768],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
    await shot('calendar-' + w);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  for (const theme of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Cognition Matrix', exact: true }).last().click();
    await page.locator('.matrix-preload-control').waitFor();
    await switches();
    await shot('switches-' + theme);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByRole('button', { name: 'Setări', exact: true }).click();
  await page.getByRole('button', { name: 'Fundal și automatizare', exact: true }).click();
  await page.getByLabel('Port pentru evenimente', { exact: true }).hover();
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').innerText(), /Numărul conexiunii/);
  await shot('event-help-ro');
  await page.evaluate(() => window.intelligence.settings({ language: 'en' }));
  const missingHelp = [];
  for (const name of [
    'Your profile',
    'Model & providers',
    'Chat & context',
    'Look & feel',
    'Icons & identity',
    'Agent access',
    'Background & automation',
    'Your data',
    'Cognition Matrix',
    'Search providers',
  ]) {
    console.log('Checking Settings help: ' + name);
    await page
      .locator('.settings-dialog > aside')
      .getByRole('button', { name, exact: true })
      .click();
    await page.waitForTimeout(100);
    const controls = page.locator(
      '.settings-content input:visible,.settings-content select:visible,.settings-content textarea:visible',
    );
    for (let i = 0; i < (await controls.count()); i++) {
      const control = controls.nth(i);
      await control.scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      await page.mouse.move(0, 0);
      await control.hover();
      await page.waitForTimeout(500);
      const visibleHelp = await control.evaluate((element) => {
        const candidates = [
          element.closest('label')?.querySelector('small'),
          ...(element.getAttribute('aria-describedby') || '')
            .split(/\s+/)
            .map((id) => document.getElementById(id)),
        ];
        return candidates.some((node) => {
          if (!node?.textContent?.trim()) return false;
          const rect = node.getBoundingClientRect(),
            style = getComputedStyle(node);
          return (
            rect.width > 2 &&
            rect.height > 2 &&
            style.clip === 'auto' &&
            style.clipPath === 'none' &&
            style.visibility !== 'hidden'
          );
        });
      });
      if (!(await page.getByRole('tooltip').count()) && !visibleHelp)
        missingHelp.push(
          await control.evaluate(
            (e) =>
              e.getAttribute('aria-label') ||
              e.closest('label')?.textContent?.trim() ||
              e.outerHTML,
          ),
        );
    }
  }
  assert.deepEqual(
    missingHelp,
    [],
    'Every visible Settings field/switch needs onscreen explanation or meaningful tooltip help',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        directory,
        checks:
          'empty task report, switch dimensions/spacing, port draft/validation/save, tooltips EN/RO, backup alignment/font, guide switches/single theme option, mode-free selection controls, calendar entry/day/background menus, date-correct creation/Trash, six themes and three sizes',
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const timeout = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timeout);
  }
}

import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Only the affected collection layouts: mixed content, optional provenance and actions.
const baseline = process.argv.includes('--baseline');
const directory = path.resolve(
  `.test-data/collection-layout-${baseline ? 'before' : 'after'}-${Date.now()}`,
);
fs.mkdirSync(directory, { recursive: true });
console.log(directory);
const store = new Store(path.join(directory, 'data'));
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  backgroundPaused: true,
  theme: 'marble',
  skillsView: 'cards',
});
const skills = [
  ['Understand a Linux problem', 'Inspect, explain, and verify.'],
  [
    'MCP server setup',
    'Configure and connect an MCP tool server requested by the user; local stdio and Streamable HTTP, not inference providers.',
  ],
  [
    'X4 Linux Mod Compatibility',
    'Check and fix X4 Foundations mods for Linux compatibility. Scans XML, casing, permissions, DLLs, and Lua paths. Offers safe fixes with backup, validation, and auto-rollback.',
    true,
  ],
  [
    'Create a New Skill',
    'Guide for creating a new Intelligence skill: directory structure, SKILL.md format, where to place files, and the full workflow for registering and testing a skill.',
    true,
  ],
  ['A longer skill title that wraps onto multiple lines', 'Short instructions.'],
  ['Review pending', 'A learned skill waiting for review.', true],
  ['Long unbroken content', 'collection-layout-'.repeat(20), true],
].map(([title, description, generated], i) =>
  store.mutate({
    kind: 'skill',
    title,
    data: {
      description,
      content: '# Fixture instructions',
      access: i !== 5,
      generated: !!generated,
      creatorName: 'Nova',
      learningState: i === 5 ? 'review' : 'active',
    },
  }),
);
for (let i = 0; i < 5; i++) {
  store.mutate({
    kind: 'project',
    title: i === 0 ? 'Short project' : `Longer project name ${i} with several words`,
    data: {
      directory: path.join(directory, i === 1 ? 'nested-project-'.repeat(12) : `project-${i}`),
      access: true,
    },
  });
  store.mutate({
    kind: 'connection',
    title: i === 0 ? 'Short connection' : `A longer connection title ${i}`,
    data: {
      transport: 'stdio',
      command: i === 1 ? 'long-command-'.repeat(12) : 'node',
      args: [],
      enabled: false,
    },
  });
}
store.close();
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: path.join(directory, 'data'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
const results = { baseline, captures: [], errors: [], violations: [] };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => results.errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const configure = async (changes) => {
    await page.evaluate((changes) => window.intelligence.settings(changes), changes);
    if (changes.theme)
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        changes.theme,
      );
    await page.waitForTimeout(80);
  };
  const resize = async (width, height) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await page.waitForTimeout(100);
  };
  const nav = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    if (name === 'Skills') await page.locator('.skills-page').waitFor();
    if (name === 'Projects') await page.locator('.projects-page').waitFor();
    if (name === 'Connections')
      await page
        .getByRole('heading', { name: 'A few helpful connections.', exact: true })
        .waitFor();
  };
  const check = async (name) => {
    await page.locator('.workspace').evaluate((e) => (e.scrollTop = 0));
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.locator('.resource-grid').evaluate((grid) => {
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      return {
        list: grid.classList.contains('resource-list'),
        grid: rect(grid),
        overflow: grid.scrollWidth - grid.clientWidth,
        cards: [...grid.querySelectorAll('.resource-card')].map((card) => ({
          title: card.querySelector('h2').textContent,
          ...rect(card),
          overflow: card.scrollWidth - card.clientWidth,
          controls: [
            ...card.querySelectorAll(
              '.resource-card > button, .check-label, .skill-provenance, h2, p',
            ),
          ]
            .filter((e) => e.getBoundingClientRect().height && e.textContent.trim())
            .map((e) => ({ name: e.className || e.tagName, ...rect(e) })),
        })),
      };
    });
    const violations = [];
    const heights = layout.cards.map((c) => c.height),
      widths = layout.cards.map((c) => c.width);
    if (Math.max(...heights) - Math.min(...heights) > 1) violations.push('Unequal card heights');
    if (Math.max(...widths) - Math.min(...widths) > 1) violations.push('Unequal card widths');
    if (layout.overflow > 2 || layout.cards.some((c) => c.overflow > 2))
      violations.push('Collection/card overflow');
    for (const card of layout.cards) {
      for (const control of card.controls) {
        if (
          control.x < card.x ||
          control.right > card.right + 1 ||
          control.bottom > card.bottom + 1
        )
          violations.push(`${card.title}: control outside card`);
        if (
          name.startsWith('skills') &&
          (control.name === 'skill-open' || control.name === 'BUTTON') &&
          control.width < 100
        )
          violations.push(`${card.title}: squeezed instructions action`);
      }
      for (let i = 0; i < card.controls.length; i++)
        for (let j = i + 1; j < card.controls.length; j++) {
          const a = card.controls[i],
            b = card.controls[j];
          if (
            Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1
          )
            violations.push(`${card.title}: overlapping ${a.name}/${b.name}`);
        }
    }
    if (!layout.list && name.startsWith('skills')) {
      const offsets = layout.cards
        .map((c) => c.controls.find((e) => e.name === 'skill-open'))
        .filter(Boolean)
        .map((b, i) => layout.cards[i].bottom - b.bottom);
      if (Math.max(...offsets) - Math.min(...offsets) > 1)
        violations.push('Unaligned card actions');
    }
    results.violations.push(...violations.map((issue) => ({ name, issue })));
    results.captures.push({ name, layout });
    // Flush the compositor after navigation; geometry can update before its painted frame.
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(100);
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
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(png, 'base64'));
    if (!baseline) assert.deepEqual(violations, [], name);
  };
  await resize(1920, 1080);
  for (const theme of [
    'ink',
    'day',
    'night',
    'summer',
    'autumn',
    'winter',
    'festive',
    'tech',
    'astral',
    'marble',
  ]) {
    await configure({ theme, skillsView: 'cards' });
    await nav('Skills');
    await check(`skills-${theme}-cards`);
    await page.locator('.skills-page select').first().selectOption('list');
    await page.locator('.resource-list').waitFor();
    await check(`skills-${theme}-list`);
  }
  for (const [width, height, zoom, language, assistant] of [
    [1366, 768, 1, 'en', false],
    [2560, 1440, 1, 'en', false],
    [1920, 1080, 1.25, 'en', false],
    [1366, 768, 1, 'ro', false],
    [1366, 768, 1, 'en', true],
    [1000, 700, 1, 'ro', true],
  ]) {
    await resize(width, height);
    await configure({ language });
    await page.evaluate((zoom) => (document.body.style.zoom = zoom), zoom);
    if ((await page.locator('.assistant-pane').count()) > 0 !== assistant)
      await page.locator('.assistant-toggle').click();
    for (const view of ['cards', 'list']) {
      await page.locator('.skills-page select').first().selectOption(view);
      await check(`skills-${width}-${height}-${zoom}-${language}-${assistant}-${view}`);
    }
  }
  if (await page.locator('.assistant-pane').count())
    await page.locator('.assistant-toggle').click();
  await resize(1920, 1080);
  await page.evaluate(() => (document.body.style.zoom = 1));
  await configure({ language: 'en', skillsView: 'cards' });
  // Exercise the real editor, availability toggle and menu after changing layout.
  const skill = page.locator('.resource-card').filter({ hasText: 'X4 Linux Mod Compatibility' });
  await skill.locator('.skill-open, button').filter({ hasText: 'Open instructions' }).click();
  await page.getByRole('heading', { name: 'Edit skill', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const checkbox = skill.locator('input[type=checkbox]');
  await checkbox.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id).data.access ===
      false,
    skills[2].id,
  );
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).entities.find(
      (e) => e.id === skills[2].id,
    ).data.access,
    false,
  );
  await checkbox.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id).data.access ===
      true,
    skills[2].id,
  );
  await skill.locator('.dropdown > summary').click();
  await page.getByRole('button', { name: 'Rename', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  for (const section of ['Projects', 'Connections']) {
    await nav(section);
    await check(section.toLowerCase());
    await resize(1366, 768);
    await check(section.toLowerCase() + '-1366');
    await resize(1920, 1080);
  }
  assert.deepEqual(results.errors, []);
  if (baseline) assert.ok(results.violations.length, 'Baseline should reproduce the defects');
  console.log(
    `${results.captures.length} captures; ${results.violations.length} layout violations; ${results.errors.length} renderer errors`,
  );
} finally {
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  await app.close();
}

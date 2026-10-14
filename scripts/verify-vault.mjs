import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/vault-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
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
  page.setDefaultTimeout(12000);
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  const capture = async (name) => {
    await page.waitForTimeout(120);
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
    });
    await page.waitForTimeout(120);
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
    fs.writeFileSync(path.join(directory, name), Buffer.from(png, 'base64'));
  };
  await page.evaluate(() =>
    window.intelligence.settings({ semanticSearch: false, autoConsolidation: false }),
  );
  await page.locator('.sidebar nav').getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('button', { name: '＋ Folder', exact: true }).click();
  await page.getByLabel('Vault item name').fill('Research');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Research', exact: true }).waitFor();
  await page.getByRole('button', { name: '＋ File', exact: true }).click();
  await page.getByLabel('Vault item name').fill('Ideas');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Vault content' });
  await editor.waitFor();
  await editor.fill('Knowledge kept in Markdown.');
  await page.waitForTimeout(1000);
  assert.match(
    fs.readFileSync(path.join(directory, 'Vault', 'Research', 'Ideas.md'), 'utf8'),
    /Knowledge/,
  );
  await editor.click();
  await page.getByRole('button', { name: 'Insert table', exact: true }).click();
  await page.locator('.note-prose table').waitFor();
  await page.waitForTimeout(900);
  assert.match(
    fs.readFileSync(path.join(directory, 'Vault', 'Research', 'Ideas.md'), 'utf8'),
    /\|/,
  );
  await page.getByLabel('Vault document font').selectOption('garamond');
  await page.waitForTimeout(200);
  assert.match(await editor.evaluate((e) => getComputedStyle(e).fontFamily), /Garamond/);
  assert.match(
    await page.locator('.sidebar').evaluate((e) => getComputedStyle(e).fontFamily),
    /Inter/,
  );
  await capture('vault-en.png');
  const imageName = '22222222-2222-4222-8222-222222222222.png';
  fs.copyFileSync(
    'public/assets/icon-prism.png',
    path.join(directory, 'Vault', '.assets', imageName),
  );
  await page.evaluate(async (name) => {
    const file = (await window.intelligence.bootstrap()).entities.find(
      (e) => e.kind === 'vault-file',
    );
    const current = await window.intelligence.vault({ action: 'read', id: file.id });
    await window.intelligence.vault({
      action: 'save',
      id: file.id,
      revision: current.revision,
      content:
        current.data.content +
        '\n\n![Colorful icon](.assets/' +
        name +
        ')\n\nText around the image.',
    });
  }, imageName);
  const picture = page.locator('.note-prose img');
  await picture.waitFor();
  await picture.click();
  await page.getByLabel('Image width', { exact: true }).selectOption('400');
  await page.getByLabel('Image layout', { exact: true }).selectOption('left');
  await page.waitForTimeout(900);
  assert.match(
    fs.readFileSync(path.join(directory, 'Vault', 'Research', 'Ideas.md'), 'utf8'),
    /data-align="left"/,
  );
  await page.getByRole('button', { name: 'Reload from disk ↻', exact: true }).click();
  await picture.waitFor();
  assert.equal(await picture.getAttribute('width'), '400');
  assert.equal(await picture.getAttribute('data-align'), 'left');
  await capture('vault-image-layout-en.png');
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('ro');
  await page.getByRole('button', { name: 'Aspect și stil', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ro');
  await capture('settings-ro.png');
  await page.getByRole('button', { name: 'Model și furnizori', exact: true }).click();
  await page.getByLabel('Furnizor de inferență', { exact: true }).selectOption('openai');
  await page.getByLabel('Cheie API pentru inferență').fill('fixture-key-never-use');
  await page.getByRole('button', { name: 'Salvează cheia API', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(
    !JSON.stringify(await page.evaluate(() => window.intelligence.bootstrap())).includes(
      'fixture-key-never-use',
    ),
  );
  await capture('providers-ro.png');
  await page.getByRole('button', { name: 'Elimină cheia API', exact: true }).click();
  await page.getByLabel('Furnizor de inferență', { exact: true }).selectOption('ollama');
  await page.getByRole('button', { name: 'Închide setările', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Vault', exact: true }).click();
  await capture('vault-ro.png');
  const file = (await page.evaluate(() => window.intelligence.bootstrap())).entities.find(
    (e) => e.kind === 'vault-file',
  );
  await page.evaluate((id) => window.intelligence.vault({ action: 'trash', id }), file.id);
  await page.getByRole('button', { name: /^Setări/ }).click();
  await page.getByRole('button', { name: 'Datele tale', exact: true }).click();
  await page.getByRole('button', { name: /Deschide coșul/ }).click();
  await page.getByRole('button', { name: /^Fișiere/ }).click();
  await page.getByRole('button', { name: 'Restaurează Ideas.md', exact: true }).click();
  assert.ok(fs.existsSync(path.join(directory, 'Vault', 'Research', 'Ideas.md')));
  await capture('trash-ro.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Matrice cognitivă', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ro');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        'real Markdown files',
        'tables and autosave',
        'image width/wrapping survives reload',
        'Vault fonts do not override app font',
        'Romanian Settings/navigation',
        'API credential exclusion',
        'grouped Trash and filesystem restore',
        'locale persistence',
        '1920x1080',
      ],
    }),
  );
} finally {
  await app.close();
}

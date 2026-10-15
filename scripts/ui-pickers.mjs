export async function pickChoice(page, trigger, label, scope = page) {
  await scope.getByRole('button', { name: trigger, exact: true }).click();
  const panel = page.getByRole('dialog', { name: trigger, exact: true });
  await panel.getByRole('textbox', { name: 'Search choices', exact: true }).fill(label);
  await panel.locator('.picker-option').filter({ hasText: label }).first().click();
}
export async function settingsSection(page, name) {
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: name === 'Icons & identity' ? 'Look & feel' : name, exact: true })
    .click();
  if (name === 'Icons & identity') {
    const details = page
      .locator('.settings-content details')
      .filter({ has: page.locator('summary').filter({ hasText: 'Icons & identity' }) })
      .first();
    if ((await details.getAttribute('open')) === null)
      await details.locator('summary').first().click();
  }
}
export async function pickValue(page, trigger, value, scope = page) {
  await scope.getByRole('button', { name: trigger, exact: true }).click();
  const panel = page.getByRole('dialog', { name: trigger, exact: true }),
    buttons = panel.locator('.picker-option');
  const index = await buttons.evaluateAll(
    (elements, value) => elements.findIndex((element) => element.dataset.value === value),
    value,
  );
  if (index < 0) throw Error('Picker choice unavailable: ' + value);
  await buttons.nth(index).click();
}

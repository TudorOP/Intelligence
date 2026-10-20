export function restoreWindow(saved, displays) {
  const primary = displays[0];
  const valid = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k]));
  const overlap = (d) =>
    Math.max(0, Math.min(saved.x + saved.width, d.x + d.width) - Math.max(saved.x, d.x)) *
    Math.max(0, Math.min(saved.y + saved.height, d.y + d.height) - Math.max(saved.y, d.y));
  const area = valid
    ? displays.reduce((best, d) => (overlap(d) > overlap(best) ? d : best), primary)
    : primary;
  const width = Math.min(Math.max(820, valid ? saved.width : 1280), area.width);
  const height = Math.min(Math.max(600, valid ? saved.height : 800), area.height);
  return {
    width,
    height,
    x: Math.max(
      area.x,
      Math.min(valid ? saved.x : area.x + (area.width - width) / 2, area.x + area.width - width),
    ),
    y: Math.max(
      area.y,
      Math.min(
        valid ? saved.y : area.y + (area.height - height) / 2,
        area.y + area.height - height,
      ),
    ),
    maximized: valid && saved.maximized === true,
  };
}

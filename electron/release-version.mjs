export function releaseLabel(version) {
  if (!/^\d+\.\d\.\d$/.test(String(version))) throw Error('Invalid release version');
  const [major, tenth, hundredth] = String(version).split('.').map(Number);
  if (
    ![major, tenth, hundredth].every(Number.isInteger) ||
    tenth < 0 ||
    tenth > 9 ||
    hundredth < 0 ||
    hundredth > 9
  )
    throw Error('Invalid release version');
  return `${major}.${tenth}${hundredth ? hundredth : ''}`;
}
export function nextRelease(version) {
  const [major, tenth, hundredth] = String(version).split('.').map(Number);
  releaseLabel(version);
  const value = major * 100 + tenth * 10 + hundredth + 1;
  return `${Math.floor(value / 100)}.${Math.floor((value % 100) / 10)}.${value % 10}`;
}

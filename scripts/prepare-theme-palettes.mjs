import fs from 'node:fs';
const keys = ['bg','sidebar','local-nav','surface','assistant','input','compose','popover','hover','line','line-strong','text','muted','subtle','accent','accent-hover','accent-ink','accent-dim','accent-soft','selection','nav-selected','search-bg','shadow','shadow-heavy','overlay','danger'];
const palettes = {
  festive: ['#151f19','#25171a','#17261c','#1c2a20','#18261e','#142018','#1c2b21','#1c2b21','#2e3d2b','#354235','#66593e','#f7f0df','#c4c8b1','#a2af9c','#e1bf77','#f0d28f','#2b2214','#a48a59','#363c26','#465333','#35452e','#1d2c22','#00000026','#00000066','#080e0bc4','#ffb7a5'],
  tech: ['#0c1412','#090f0e','#101a16','#14211b','#0e1b16','#0b1611','#15231c','#14251c','#1c3427','#294738','#48765d','#e0f4e8','#a0c4af','#83a58e','#91e4ac','#b5f2c6','#0d291b','#528267','#1c3828','#2d6141','#1d3c2c','#11271b','#00000025','#00000072','#050d0acc','#ffb6a4'],
  astral: ['#111422','#0e1120','#15192c','#1b2035','#14192b','#101629','#1d233a','#1b233b','#2a304b','#353b58','#697092','#f1eee4','#bbbcd2','#969ebb','#ddc68c','#f0dbac','#242035','#948569','#2c2b40','#434260','#2b304b','#1b2039','#00000026','#00000070','#080b18c4','#ffb8b2'],
  marble: ['#f8f6f1','#eeeae1','#f3f0e9','#fffefa','#f1eee7','#f8f6f1','#fffefa','#fffefa','#ede8df','#ddd5c7','#b8a98f','#322e27','#686052','#7c705e','#805d26','#65471b','#fffaf0','#a18754','#eee5d2','#dfd0ad','#e8dfcd','#e7e1d5','#52422910','#44331830','#28221970','#a32e2a'],
};
let css = '/* Independent palettes; reading and controls stay on solid surfaces. */\n';
for (const [theme, colours] of Object.entries(palettes)) {
  css += `[data-theme='${theme}'] {\n  color-scheme: ${theme === 'marble' ? 'light' : 'dark'};\n`;
  css += keys.map((key, index) => `  --${key}: ${colours[index]};`).join('\n');
  css += `\n  --theme-art: url('/assets/theme-${theme}.webp');\n  --theme-background: url('/assets/background-${theme}.webp');\n  --theme-motif: url('/assets/background-${theme}.webp');\n  --mark-filter: ${theme === 'marble' ? 'none' : 'brightness(1.7)'};\n}\n`;
  css += `[data-theme='${theme}'] .theme-banner { background-image: var(--banner-${theme}); }\n`;
}
css += `
.app-shell { isolation: isolate; position: relative; }
.app-shell[data-backgrounds='true'] .workspace::before { content: none; }
.app-background-art { position: fixed; inset: 34px 0 0; width: 100%; height: calc(100% - 34px); z-index: -1; pointer-events: none; }
.app-background-art { background-position: center; background-size: cover; background-repeat: no-repeat; }
.workspace-top { background:var(--bg); }
[data-theme='festive'] .welcome h1, [data-theme='astral'] .welcome h1 { font-family: 'Lora Variable', serif; }
[data-theme='festive'] .workspace-top { border-bottom-color: #74603e; }
[data-theme='festive'] .sidebar nav button.active { box-shadow: inset 2px 0 #d4ad60; }
[data-theme='tech'] .eyebrow { font-family: 'JetBrains Mono Variable', monospace; letter-spacing: .16em; }
[data-theme='tech'] .workspace-top { border-bottom-color: #396348; }
[data-theme='marble'] .welcome h1 { font-family: 'EB Garamond Variable', serif; font-weight: 500; }
[data-theme='marble'] .workspace-top { border-bottom-color: #c8b589; }
[data-theme='marble'] .sidebar nav button.active { box-shadow: inset 2px 0 #a18446; }
.settings-dialog .theme-options { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.settings-dialog .theme-options > button > .theme-art { height: 48px; }
.settings-dialog .theme-options > button > span:not(.theme-art) { min-height: 22px; line-height:1.3; }
.appearance-settings .settings-card { padding:18px; }
.appearance-settings .settings-card h3 { margin-bottom:12px; }
.settings-dialog .appearance-settings .theme-options { margin-bottom:12px; gap:6px; }
.background-settings-card { grid-column: 1 / -1; }
.background-settings-heading { display:flex; align-items:baseline; gap:16px; margin-bottom:12px; }
.background-settings-heading > span { color:var(--muted); font-size:12px; }
.background-layer-grid { display:grid; grid-template-columns:1fr 1fr; gap:26px; }
.background-layer-grid > div { display:grid; gap:10px; align-content:start; }
.settings-dialog .background-layer-grid label { margin:0; }
.background-settings-heading h3 { margin:0; }
.settings-dialog .background-range input { min-height:18px; height:18px; padding:0; }
.background-layer-grid label { display:flex; align-items:center; justify-content:space-between; gap:14px; font-size:12px; }
.background-layer-grid select { width: min(260px, 60%); }
.background-layer-grid .background-range { display:grid; grid-template-columns:1fr auto; gap:4px 12px; }
.background-range input { grid-column:1 / -1; width:100%; padding:0; height:18px; accent-color:var(--accent); border:0; }
.background-image-actions { display:flex; gap:8px; flex-wrap:wrap; }
.background-layer-grid button { width:max-content; max-width:100%; font-size:12px; padding:7px 10px; }
.background-settings-card .settings-note { margin:10px 0 0; }
.workspace-top .background-pause { display:inline-flex; align-items:center; gap:7px; height:32px; padding:6px 10px; flex-shrink:0; font-family:inherit; font-size:11px; line-height:1.2; font-weight:500; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:8px; box-shadow:none; }
.workspace-top .background-pause .symbol-icon { width:14px; height:14px; }
.workspace-top .background-pause:hover, .workspace-top .background-pause[data-paused='true'] { color:var(--text); background:var(--hover); border-color:var(--line-strong); }
@media (max-width:900px) { .background-layer-grid { grid-template-columns:1fr; gap:18px; } .settings-dialog .theme-options { grid-template-columns:repeat(3,minmax(0,1fr)); } }
`;
fs.writeFileSync('src/theme-extensions.css', css);

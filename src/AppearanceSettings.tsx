import type { Settings } from './types';
import { t } from './i18n';
import { themes } from './themes';
import { iconChoices, logoPath } from './branding';
import ThemeArt from './ThemeArt';
import Switch from './Switch';
import { api } from './api';
import { useState } from 'react';
export default function AppearanceSettings({
  settings,
  onUpdate,
  identity = false,
}: {
  settings: Settings;
  onUpdate: (s: Partial<Settings>) => Promise<any>;
  identity?: boolean;
}) {
  const [backgroundError, setBackgroundError] = useState('');
  const [importingBackground, setImportingBackground] = useState(false);
  const importBackground = async () => {
    setBackgroundError('');
    setImportingBackground(true);
    try {
      const image = await api.image('background');
      if (image)
        await onUpdate({
          backgroundImage: image,
          backgroundArtwork: 'custom',
          decorativeBackgrounds: true,
          backgroundOpacity: Math.max(12, settings.backgroundOpacity ?? 7),
        });
    } catch (e) {
      setBackgroundError((e as Error).message);
    } finally {
      setImportingBackground(false);
    }
  };
  if (identity)
    return (
      <section className="settings-section">
        <span className="eyebrow">{t('IDENTITY')}</span>
        <h2>{t('Icons & identity')}</h2>
        <div className="settings-grid settings-icon-cards">
          {(
            [
              ['appIcon', 'App window icon'],
              ['trayIcon', 'Tray icon'],
              ['logoIcon', 'In-app logo'],
            ] as const
          ).map(([key, label]) => (
            <section className="settings-card" key={key}>
              <h3>{t(label)}</h3>
              <div className="settings-icon-preview">
                <img src={logoPath(settings[key])} alt="" />
              </div>
              <label>
                {t('Icon style')}
                <select
                  aria-label={t(label)}
                  value={settings[key]}
                  onChange={(e) => void onUpdate({ [key]: e.target.value })}
                >
                  {iconChoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {t(i.label)}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          ))}
        </div>
        <p className="settings-note">
          {t(
            'The desktop launcher uses the build’s icon. See the Linux guide to choose its packaged variant.',
          )}
        </p>
      </section>
    );
  return (
    <section className="settings-section appearance-settings">
      <span className="eyebrow">{t('MAKE YOURSELF AT HOME')}</span>
      <h2>{t('Appearance & comfort')}</h2>
      <div className="settings-grid">
        <section className="settings-card settings-theme-card">
          <h3>{t('Theme')}</h3>
          <div className="theme-options">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={settings.theme === theme.id ? 'selected' : ''}
                aria-pressed={settings.theme === theme.id}
                onClick={() => void onUpdate({ theme: theme.id })}
              >
                <ThemeArt
                  category={0}
                  variant="banner"
                  source={
                    theme.id === 'ink'
                      ? 'day-ink.webp'
                      : 'banner-' + (theme.id === 'system' ? 'day' : theme.id) + '-0.webp'
                  }
                />
                <span>
                  {theme.symbol} {t(theme.label)}
                </span>
              </button>
            ))}
          </div>
          <button
            className="quiet-button"
            onClick={() =>
              void onUpdate({
                theme: 'night',
                layout: 'studio',
                accent: '#a9c4b4',
                appIcon: 'original',
                trayIcon: 'original',
                logoIcon: 'original',
                backgroundArtwork: 'theme',
                decorativeBackgrounds: true,
                backgroundOpacity: 7,
                backgroundBlur: 0,
              })
            }
          >
            {t('Reset appearance')}
          </button>
        </section>
        <section className="settings-card">
          <h3>{t('Display & comfort')}</h3>
          <div className="settings-fields">
            <label>
              {t('Notebook look')}
              <select
                aria-label={t('Notebook look')}
                value={settings.notebookLook}
                onChange={(e) =>
                  void onUpdate({ notebookLook: e.target.value as Settings['notebookLook'] })
                }
              >
                {[
                  ['bound', 'Bound book (original)'],
                  ['paperback', 'Paperback'],
                  ['spiral', 'Spiral notebook'],
                  ['index', 'Index card'],
                  ['folio', 'Folio'],
                ].map(([v, l]) => (
                  <option value={v} key={v}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Language')}
              <select
                aria-label={t('Language')}
                value={settings.language}
                onChange={(e) =>
                  void onUpdate({ language: e.target.value as Settings['language'] })
                }
              >
                <option value="en">{t('English')}</option>
                <option value="ro">{t('Romanian')}</option>
              </select>
            </label>
          </div>
          <label className="setting-switch">
            <span>{t('Subtle background artwork')}</span>
            <Switch
              checked={settings.decorativeBackgrounds !== false}
              onChange={(e) => void onUpdate({ decorativeBackgrounds: e.target.checked })}
            />
          </label>
          <label className="settings-color-field">
            {t('Accent color')}
            <input
              aria-label={t('Accent color')}
              type="color"
              value={settings.accent}
              onChange={(e) => void onUpdate({ accent: e.target.value })}
            />
          </label>
          <button
            onClick={() =>
              void onUpdate({ paneWidths: { sidebar: 238, navigator: 265, assistant: 390 } })
            }
          >
            {t('Reset pane widths')}
          </button>
          <p className="settings-note">
            {t('Interface transitions follow your system’s reduced-motion preference.')}
          </p>
        </section>
        <section className="settings-card background-settings-card">
          <div className="background-settings-heading">
            <h3>{t('Background artwork')}</h3>
            <span>{t('Independent of your theme')}</span>
          </div>
          <div className="background-layer-grid still-background-settings">
            <div>
              <label>
                {t('Still artwork')}
                <select
                  aria-label={t('Still artwork')}
                  value={settings.backgroundArtwork ?? 'theme'}
                  onChange={(e) =>
                    void onUpdate({
                      backgroundArtwork: e.target.value as Settings['backgroundArtwork'],
                      decorativeBackgrounds: true,
                    })
                  }
                >
                  <option value="theme">{t('Match theme')}</option>
                  {themes
                    .filter((theme) => theme.id !== 'system')
                    .map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {t(theme.label)}
                      </option>
                    ))}
                  <option value="custom" disabled={!settings.backgroundImage}>
                    {t('Your image')}
                  </option>
                </select>
              </label>
              <label className="background-range">
                {t('Artwork strength')} <output>{settings.backgroundOpacity ?? 7}%</output>
                <input
                  type="range"
                  min="0"
                  max="35"
                  aria-label={t('Artwork strength')}
                  value={settings.backgroundOpacity ?? 7}
                  onChange={(e) => void onUpdate({ backgroundOpacity: Number(e.target.value) })}
                />
              </label>
              <div className="background-image-actions">
                <button disabled={importingBackground} onClick={() => void importBackground()}>
                  {t(
                    settings.backgroundImage
                      ? 'Replace background image'
                      : 'Choose background image',
                  )}
                </button>
                {settings.backgroundImage ? (
                  <button
                    className="quiet-button"
                    onClick={() =>
                      void onUpdate({ backgroundImage: '', backgroundArtwork: 'theme' })
                    }
                  >
                    {t('Remove image')}
                  </button>
                ) : null}
              </div>
            </div>
            <div>
              <label className="background-range">
                {t('Background blur')} <output>{settings.backgroundBlur ?? 0} px</output>
                <input
                  type="range"
                  min="0"
                  max="24"
                  aria-label={t('Background blur')}
                  value={settings.backgroundBlur ?? 0}
                  onChange={(e) => void onUpdate({ backgroundBlur: Number(e.target.value) })}
                />
              </label>
              <button className="quiet-button" onClick={() => void onUpdate({ backgroundBlur: 0 })}>
                {t('Remove blur')}
              </button>
            </div>
          </div>
          <p className="settings-note">
            {t(
              'Use built-in artwork or your image. Zero blur keeps the source image clear; blur affects only the background.',
            )}
          </p>
          {backgroundError ? <p role="alert">{t(backgroundError)}</p> : null}
        </section>
      </div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { t } from './i18n';
import Modal from './Modal';
export default function LicensesPanel({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState<any[]>([]),
    [selected, setSelected] = useState('GPL-3.0.txt'),
    [text, setText] = useState(''),
    [query, setQuery] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void fetch('./licenses/index.json')
      .then((r) => r.json())
      .then((v) => {
        if (alive) setIndex(v.entries);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setText('');
    void fetch('./licenses/' + selected)
      .then((r) => {
        if (!r.ok) throw Error('License document unavailable');
        return r.text();
      })
      .then((value) => {
        if (alive)
          setText(
            index.find((v) => v.file === selected)?.format === 'html'
              ? new DOMParser().parseFromString(value, 'text/html').body.textContent || value
              : value,
          );
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [selected]);
  return (
    <Modal title={t('Licenses')} onClose={onClose} className="license-reader">
      <p>
        {t(
          'Intelligence original code: GPLv3. Copyright © 2026 Octavian and contributors. Distributed without warranty. You may modify and redistribute it under the license terms.',
        )}
      </p>
      <p>
        {t(
          'Corresponding source and build scripts accompany the release. Third-party software and content retain their own licenses.',
        )}
      </p>
      <label>
        {t('Search licenses')}
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <select
        aria-label={t('License document')}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {index
          .filter((v) => v.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((v) => (
            <option value={v.file} key={v.id}>
              {v.title}
            </option>
          ))}
      </select>
      {error ? <p role="alert">{t(error)}</p> : null}
      <pre className="license-text">{text || t('Loading…')}</pre>
    </Modal>
  );
}

import { t } from './i18n';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked, type marked } from 'marked';
import type { Entity } from './types';
import { api } from './api';
import { HistoryPanel } from './WorkspacePanels';
export default function NoteEditor({
  note,
  onSaved,
  onError,
  vault = false,
}: {
  note: Entity;
  onSaved: (e: Entity) => void;
  onError: (s: string) => void;
  vault?: boolean;
}) {
  const draftKey = 'intelligence-note-draft-' + note.id;
  // Markdown registers tokenizer closures. A global parser would retain closed editors.
  const markdownParser = useMemo(() => new Marked(), []);
  const recovered = useRef<{ content: string; revision: number } | null>(null);
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    try {
      recovered.current = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
    } catch {}
  }
  const current = useRef(note),
    pending = useRef<string | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saving = useRef(false);
  const [status, setStatus] = useState(t('Saved locally'));
  const [, setSelectionVersion] = useState(0);
  const callbacks = useRef({ onSaved, onError });
  callbacks.current = { onSaved, onError };
  async function flush() {
    if (saving.current || pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    saving.current = true;
    setStatus(t('Saving…'));
    try {
      const input = {
        id: current.current.id,
        revision: current.current.revision,
        data: { content: text },
      };
      const e = vault
        ? await api.vault({ action: 'save', id: input.id, revision: input.revision, content: text })
        : await api.mutate(input);
      current.current = e;
      recovered.current = null;
      callbacks.current.onSaved(e);
      setStatus(t('Saved locally'));
      if (pending.current === null) localStorage.removeItem(draftKey);
    } catch (e) {
      pending.current = pending.current ?? text;
      setStatus(t('Save needs attention'));
      callbacks.current.onError((e as Error).message);
      return;
    } finally {
      saving.current = false;
    }
    if (pending.current !== null) void flush();
  }
  const editor = useEditor({
    onSelectionUpdate: () => setSelectionVersion((v) => v + 1),
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            align: {
              default: 'center',
              parseHTML: (element) =>
                ['left', 'right', 'center'].includes(element.getAttribute('data-align') ?? '')
                  ? element.getAttribute('data-align')
                  : 'center',
              renderHTML: (attributes) => ({ 'data-align': attributes.align }),
            },
          };
        },
        renderMarkdown(node) {
          const src = node.attrs?.src ?? '',
            alt = node.attrs?.alt ?? '',
            title = node.attrs?.title ?? '',
            align = node.attrs?.align ?? 'center',
            width = node.attrs?.width;
          const escape = (s: string) =>
            String(s)
              .replaceAll('&', '&amp;')
              .replaceAll('"', '&quot;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;');
          return vault && (width || align !== 'center')
            ? '<img src="' +
                escape(src) +
                '" alt="' +
                escape(alt) +
                '"' +
                (width
                  ? ' width="' + Math.max(80, Math.min(1200, Number(width) || 400)) + '"'
                  : '') +
                ' data-align="' +
                align +
                '" />'
            : title
              ? '![' + alt + '](' + src + ' "' + title + '")'
              : '![' + alt + '](' + src + ')';
        },
        renderHTML({ HTMLAttributes }) {
          const src = HTMLAttributes.src;
          return [
            'img',
            {
              ...HTMLAttributes,
              src:
                vault && /^\.assets\/[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(src)
                  ? 'intelligence-media://vault/' + src.slice(8)
                  : src,
            },
          ];
        },
      }).configure({ allowBase64: true }),
      TableKit.configure({ table: { resizable: true } }),
      Placeholder.configure({ placeholder: t('A thought, a question, a beginning…') }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ marked: markdownParser as unknown as typeof marked }),
    ],
    content: note.data.content ?? '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'note-prose',
        'aria-label': vault ? t('Vault content') : t('Note content'),
      },
    },
    onUpdate: ({ editor }) => {
      pending.current = editor.getMarkdown();
      localStorage.setItem(
        draftKey,
        JSON.stringify({ content: pending.current, revision: current.current.revision }),
      );
      setStatus(t('Unsaved changes'));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 650);
    },
    onBlur: () => void flush(),
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [],
  );
  useEffect(() => {
    if (note.revision > current.current.revision && pending.current === null && !saving.current) {
      current.current = note;
      editor?.commands.setContent(note.data.content ?? '', {
        contentType: 'markdown',
        emitUpdate: false,
      });
    }
  }, [note.revision]);
  const image = async () => {
    const imported = vault ? await api.vault({ action: 'image' }) : null;
    const src = vault ? imported?.markdown : await api.image();
    if (src)
      editor
        ?.chain()
        .focus()
        .setImage({ src, alt: t('Image') })
        .run();
  };
  if (!editor) return null;
  return (
    <>
      {!vault ? (
        <HistoryPanel
          item={note}
          onChanged={() =>
            void api.bootstrap().then((s) => {
              const updated = s.entities.find((e) => e.id === note.id);
              if (updated) onSaved(updated);
            })
          }
          onError={(e) => onError(e.message)}
        />
      ) : null}
      {recovered.current ? (
        <div className="draft-recovery">
          <span>{t('An unsaved draft is available. Review it before saving.')}</span>
          <button
            onClick={() => {
              const text = recovered.current!.content;
              recovered.current = null;
              editor.commands.setContent(text, { contentType: 'markdown', emitUpdate: true });
            }}
          >
            {t('Recover draft')}
          </button>
        </div>
      ) : null}
      <div className="editor-tools">
        {vault && editor.isActive('image') ? (
          <>
            <label>
              {t('Image layout')}
              <select
                aria-label={t('Image layout')}
                value={editor.getAttributes('image').align ?? 'center'}
                onChange={(e) =>
                  editor.chain().focus().updateAttributes('image', { align: e.target.value }).run()
                }
              >
                <option value="center">{t('Center')}</option>
                <option value="left">{t('Wrap left')}</option>
                <option value="right">{t('Wrap right')}</option>
              </select>
            </label>
            <label>
              {t('Image width')}
              <select
                aria-label={t('Image width')}
                value={String(editor.getAttributes('image').width ?? '')}
                onChange={(e) =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('image', {
                      width: e.target.value ? Number(e.target.value) : null,
                    })
                    .run()
                }
              >
                <option value="">{t('Original size')}</option>
                <option value="200">200 px</option>
                <option value="400">400 px</option>
                <option value="600">600 px</option>
                <option value="800">800 px</option>
              </select>
            </label>
          </>
        ) : null}
        <select
          aria-label={t('Text style')}
          value={
            editor.isActive('heading', { level: 1 })
              ? '1'
              : editor.isActive('heading', { level: 2 })
                ? '2'
                : '0'
          }
          onChange={(e) => {
            const v = Number(e.target.value);
            v
              ? editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: v as 1 | 2 })
                  .run()
              : editor.chain().focus().setParagraph().run();
          }}
        >
          <option value="0">{t('Text')}</option>
          <option value="1">{t('Heading 1')}</option>
          <option value="2">{t('Heading 2')}</option>
        </select>
        <span className="divider" />
        <button
          aria-label={t('Bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'active' : ''}
        >
          <b>B</b>
        </button>
        <button
          aria-label={t('Italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <button
          aria-label={t('Bullet list')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          ☷
        </button>
        <button
          aria-label={t('Checklist')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          ☑
        </button>
        <button aria-label={t('Add image')} onClick={() => void image()}>
          ▧
        </button>
        <button aria-label={t('Undo')} onClick={() => editor.chain().focus().undo().run()}>
          ↶
        </button>
        <button
          aria-label={t('Insert table')}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          ▦
        </button>
        <details className="editor-table-menu">
          <summary>{t('Table')}</summary>
          <button onClick={() => editor.chain().focus().addRowAfter().run()}>{t('Add row')}</button>
          <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
            {t('Add column')}
          </button>
          <button onClick={() => editor.chain().focus().deleteRow().run()}>
            {t('Remove row')}
          </button>
          <button onClick={() => editor.chain().focus().deleteColumn().run()}>
            {t('Remove column')}
          </button>
          <button onClick={() => editor.chain().focus().deleteTable().run()}>
            {t('Remove table')}
          </button>
        </details>
        <span className="save-state">{t(status)}</span>
      </div>
      <EditorContent editor={editor} />
    </>
  );
}

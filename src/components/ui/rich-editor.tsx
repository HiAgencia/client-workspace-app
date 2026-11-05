"use client";

import { Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { safeHref, sanitizeRichText, TONES, type Tone } from "@/lib/rich-text";
import { useStrings, type StringKey } from "@/lib/strings";
import { cx } from "@/lib/utils";
import { BoldIcon, BulletsIcon, ItalicIcon, LinkIcon, NumbersIcon, type Icon } from "./icons";

const ToneMark = Mark.create<{ tone: Tone | null }>({
  name: "tone",
  addAttributes() {
    return {
      tone: {
        default: null,
        parseHTML: (element) => {
          const tone = element.className.match(/(?:^|\s)tc-([a-z]+)/)?.[1];
          return tone && (TONES as readonly string[]).includes(tone) ? tone : null;
        },
        renderHTML: (attributes) => (attributes.tone ? { class: `tc-${attributes.tone}` } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[class]", getAttrs: (element) => (/(?:^|\s)tc-[a-z]+/.test((element as HTMLElement).className) ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

const TONE_NAMES: Record<Tone, StringKey> = { red: "color.red", amber: "color.amber", green: "color.green", blue: "color.blue", violet: "color.violet" };

type RichEditorProps = {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  label: string;
  lang?: string;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  onEscape?: () => void;
};

export function RichEditor({ value, onChange, onBlur, label, lang, placeholder, autoFocus = false, id, onEscape }: RichEditorProps) {
  const { t } = useStrings();
  const own = useId();
  const editorId = id ?? `editor-${own.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState("");
  const [linkError, setLinkError] = useState(false);
  const emitted = useRef(value);
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  }, [onEscape]);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ["mailto"], HTMLAttributes: { rel: null, target: null } },
      }),
      ToneMark,
    ],
    content: value,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape" || !escape.current) return false;
        event.preventDefault();
        escape.current();
        return true;
      },
      attributes: {
        id: editorId,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        ...(lang ? { lang } : {}),
        class: "field rich-field",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = sanitizeRichText(current.getHTML()) ?? "";
      emitted.current = html;
      onChange(html);
    },
    onBlur: () => onBlur?.(),
  });

  useEffect(() => {
    if (editor && lang) editor.view.dom.setAttribute("lang", lang);
  }, [editor, lang]);

  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const state = useEditorState({
    editor,
    selector: ({ editor: snapshot }) => {
      const current = snapshot ?? editor;
      return current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            link: current.isActive("link"),
            tone: (current.getAttributes("tone").tone as Tone | null) ?? "none",
            empty: current.isEmpty && current.state.doc.childCount === 1 && current.state.doc.firstChild?.type.name === "paragraph",
          }
        : null;
    },
  });

  function applyLink() {
    if (!editor) return;
    if (!address.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinking(false);
      return;
    }
    const raw = /^[a-z]+:/i.test(address.trim()) ? address.trim() : `https://${address.trim()}`;
    const href = safeHref(raw);
    if (!href) return setLinkError(true);
    setLinkError(false);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.setLink({ href }).run();
    setLinking(false);
    setAddress("");
  }

  function onLinkKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setLinking(false);
      editor?.commands.focus();
    }
  }

  const tool = (name: string, pressed: boolean | undefined, run: () => void, Glyph?: Icon) => (
    <button
      type="button"
      className={cx("btn btn-quiet btn-sm rich-tool", Glyph && "btn-icon")}
      aria-pressed={pressed ?? false}
      title={Glyph ? name : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {Glyph ? (
        <>
          <Glyph />
          <span className="sr-only">{name}</span>
        </>
      ) : (
        <span className="btn-label">{name}</span>
      )}
    </button>
  );

  return (
    <div className="rich" data-rich-editor data-empty={state?.empty || undefined}>
      <div className="rich-bar" role="toolbar" aria-label={t("rich.formattingOf", { label })} aria-controls={editorId}>
        {tool(t("rich.bold"), state?.bold, () => editor?.chain().focus().toggleBold().run(), BoldIcon)}
        {tool(t("rich.italic"), state?.italic, () => editor?.chain().focus().toggleItalic().run(), ItalicIcon)}
        {tool(t("rich.list"), state?.bullet, () => editor?.chain().focus().toggleBulletList().run(), BulletsIcon)}
        {tool(t("rich.numbered"), state?.ordered, () => editor?.chain().focus().toggleOrderedList().run(), NumbersIcon)}
        {tool(
          t("rich.link"),
          state?.link || linking,
          () => {
            setAddress((editor?.getAttributes("link").href as string | undefined) ?? "");
            setLinkError(false);
            setLinking((open) => !open);
          },
          LinkIcon,
        )}
        <span className="rich-sep" aria-hidden="true" />
        <span className="rich-tones" role="group" aria-label={t("rich.colorOf", { label })}>
          {TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              className={cx("btn btn-quiet btn-sm btn-icon rich-tool", `tc-${tone}`)}
              aria-pressed={state?.tone === tone}
              title={t(TONE_NAMES[tone])}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().setMark("tone", { tone }).run()}
            >
              <span className="rich-swatch" aria-hidden="true" />
              <span className="sr-only">{t(TONE_NAMES[tone])}</span>
            </button>
          ))}
          {state && state.tone !== "none" && tool(t("rich.noColor"), false, () => editor?.chain().focus().unsetMark("tone").run())}
        </span>
      </div>
      {linking && (
        <div className="rich-link">
          <input
            autoFocus
            id={`${editorId}-link`}
            name={`${editorId}-link`}
            className={cx("field", linkError && "field-invalid")}
            aria-label={t("rich.linkAddress")}
            aria-invalid={linkError || undefined}
            placeholder="https://… or mailto:…"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={onLinkKey}
          />
          <button type="button" className="btn btn-sm" onClick={applyLink}>
            <span className="btn-label">{address.trim() ? t("rich.apply") : t("rich.removeLink")}</span>
          </button>
          {linkError && (
            <p className="inline-note" data-tone="alert">
              {t("rich.onlyAddresses")}
            </p>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

export function RichText({ html, className }: { html: string | null; className?: string }) {
  const clean = sanitizeRichText(html);
  if (!clean) return null;
  return <div className={cx("rich-text", className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}

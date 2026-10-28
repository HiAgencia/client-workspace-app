"use client";

import { Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { safeHref, sanitizeRichText, TONES, type Tone } from "@/lib/rich-text";
import { cx } from "@/lib/utils";

// A color is a class of the fixed palette, painted by the theme: the editor writes `<span class="tc-red">`, never a
// `style`, so the same text reads in light and dark.
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

export const TONE_NAMES: Record<Tone, string> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue", violet: "Violet" };

type RichEditorProps = {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  // Escape inside the editor: the panel around it decides (it closes once what is pending is saved).
  onEscape?: () => void;
};

// The same editor for a note, a decision, and a task: bold, italic, lists, a link over a word or typed directly, and a
// color from the palette. What it emits passes the same sanitizer the tool layer applies when it writes.
export function RichEditor({ value, onChange, onBlur, label, placeholder, autoFocus = false, id, onEscape }: RichEditorProps) {
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

  // A value that arrives from outside (another item, a restored version) replaces the content; the editor's own echo
  // does not, so the caret stays where the person types.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            link: current.isActive("link"),
            tone: (current.getAttributes("tone").tone as Tone | null) ?? "none",
            empty: current.isEmpty,
          }
        : null,
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
    // With nothing selected the address itself is written, linked.
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

  const tool = (name: string, pressed: boolean | undefined, run: () => void) => (
    <button
      type="button"
      className="btn btn-quiet btn-sm rich-tool"
      aria-pressed={pressed ?? false}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      <span className="btn-label">{name}</span>
    </button>
  );

  return (
    <div className="rich" data-rich-editor data-empty={state?.empty || undefined}>
      <div className="rich-bar" role="toolbar" aria-label={`Formatting of ${label}`} aria-controls={editorId}>
        {tool("Bold", state?.bold, () => editor?.chain().focus().toggleBold().run())}
        {tool("Italic", state?.italic, () => editor?.chain().focus().toggleItalic().run())}
        {tool("List", state?.bullet, () => editor?.chain().focus().toggleBulletList().run())}
        {tool("Numbered", state?.ordered, () => editor?.chain().focus().toggleOrderedList().run())}
        {tool("Link", state?.link || linking, () => {
          setAddress((editor?.getAttributes("link").href as string | undefined) ?? "");
          setLinkError(false);
          setLinking((open) => !open);
        })}
        {/* The palette's colors are buttons like the rest of the bar: pressing one keeps the selection it colors. */}
        <span className="rich-tones" role="group" aria-label={`Color of the selected text in ${label}`}>
          {TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              className={cx("btn btn-quiet btn-sm rich-tool", `tc-${tone}`)}
              aria-pressed={state?.tone === tone}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().setMark("tone", { tone }).run()}
            >
              <span className="btn-label">{TONE_NAMES[tone]}</span>
            </button>
          ))}
          {state && state.tone !== "none" && tool("No color", false, () => editor?.chain().focus().unsetMark("tone").run())}
        </span>
      </div>
      {linking && (
        <div className="rich-link">
          <input
            autoFocus
            id={`${editorId}-link`}
            name={`${editorId}-link`}
            className={cx("field", linkError && "field-invalid")}
            aria-label="Link address"
            aria-invalid={linkError || undefined}
            placeholder="https://… or mailto:…"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={onLinkKey}
          />
          <button type="button" className="btn btn-sm" onClick={applyLink}>
            <span className="btn-label">{address.trim() ? "Apply" : "Remove link"}</span>
          </button>
          {linkError && (
            <p className="inline-note" data-tone="alert">
              Only web (http, https) and email (mailto) addresses are kept.
            </p>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

// Rich text read on screen: sanitized again where it is painted, whoever wrote it.
export function RichText({ html, className }: { html: string | null; className?: string }) {
  const clean = sanitizeRichText(html);
  if (!clean) return null;
  return <div className={cx("rich-text", className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}

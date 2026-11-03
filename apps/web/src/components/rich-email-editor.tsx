"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Bold,
  Code2,
  Eraser,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
} from "lucide-react";
import { sanitizeEmailHtml, wouldLoseMarkup } from "@/lib/sanitize-html";

export interface RichEmailEditorHandle {
  /** Insert text at the caret (visual) or at the end (HTML mode). */
  insert: (text: string) => void;
}

type Mode = "visual" | "html";

const TOOLS = [
  { key: "bold", icon: Bold, label: "Bold" },
  { key: "italic", icon: Italic, label: "Italic" },
  { key: "underline", icon: Underline, label: "Underline" },
  { key: "link", icon: Link2, label: "Link" },
  { key: "insertUnorderedList", icon: List, label: "Bulleted list" },
  { key: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
  { key: "clear", icon: Eraser, label: "Clear formatting" },
] as const;

/**
 * Email body editor (T4.2): a visual mode for everyday formatting and a raw
 * HTML mode for full control, editing the same HTML string. Pastes come in as
 * plain text so Word/Docs styling junk never lands in an email. Uses the
 * browser's built-in editing commands — no editor dependency.
 */
export function RichEmailEditor({
  value,
  onChange,
  placeholder,
  ref,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  ref?: React.Ref<RichEmailEditorHandle>;
}) {
  const [mode, setMode] = useState<Mode>("visual");
  const area = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  // Last HTML this editor emitted: lets outside changes (another template
  // selected) reload the surface without resetting the caret while typing.
  const emitted = useRef<string | null>(null);

  // Markup the visual surface can't round-trip (<style>, scripts, odd
  // attributes) would be lost on the first keystroke, so such bodies are
  // edited in HTML mode only.
  const htmlOnly = wouldLoseMarkup(value);
  const effective: Mode = htmlOnly ? "html" : mode;

  useEffect(() => {
    const el = area.current;
    if (effective !== "visual" || !el || value === emitted.current) return;
    el.innerHTML = sanitizeEmailHtml(value);
    emitted.current = value;
  }, [value, effective]);

  const emit = () => {
    const html = area.current?.innerHTML ?? "";
    emitted.current = html;
    onChange(html);
  };

  const exec = (cmd: string, arg?: string) => {
    area.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  useImperativeHandle(ref, () => ({
    insert: (t: string) => {
      if (effective === "visual" && area.current) {
        area.current.focus();
        document.execCommand("insertText", false, t);
        emit();
      } else {
        onChange(`${value}${t}`);
        text.current?.focus();
      }
    },
  }));

  function link() {
    const url = window.prompt("Link URL (https://…)", "https://");
    if (!url) return;
    if (!/^(https?:|mailto:)/i.test(url.trim())) {
      window.alert("Use an https:// or mailto: link.");
      return;
    }
    exec("createLink", url.trim());
  }

  function runTool(key: (typeof TOOLS)[number]["key"]) {
    if (key === "link") return link();
    if (key === "clear") {
      exec("removeFormat");
      return exec("unlink");
    }
    exec(key);
  }

  return (
    <div className="rounded border border-line-mid bg-surface focus-within:border-accent">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        {effective === "visual" &&
          TOOLS.map(({ key, icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              // keep the selection in the editor when clicking the toolbar
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runTool(key)}
              className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"
            >
              <Icon size={14} />
            </button>
          ))}
        <div className="ml-auto flex rounded bg-panel p-0.5 text-tiny">
          {(["visual", "html"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "visual" && htmlOnly}
              title={
                m === "visual" && htmlOnly
                  ? "This body uses HTML the visual editor can't keep"
                  : undefined
              }
              onClick={() => {
                if (m === "visual") emitted.current = null; // reload from value
                setMode(m);
              }}
              className={`flex items-center gap-1 rounded px-2 py-0.5 disabled:opacity-40 ${
                effective === m ? "bg-surface font-medium text-ink shadow-sm" : "text-muted"
              }`}
            >
              {m === "html" && <Code2 size={12} />}
              {m === "visual" ? "Visual" : "HTML"}
            </button>
          ))}
        </div>
      </div>
      {htmlOnly && (
        <p className="border-b border-line bg-warning-bg px-3 py-1.5 text-tiny text-warning-text">
          This body uses custom HTML (styles or unsupported tags), so it&apos;s edited as HTML to
          keep it intact.
        </p>
      )}
      {effective === "visual" ? (
        <div
          ref={area}
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emit}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
            emit();
          }}
          className="email-canvas prose-email min-h-56 px-3 py-2 text-sm outline-none empty:before:text-faint empty:before:content-[attr(data-placeholder)]"
        />
      ) : (
        <textarea
          ref={text}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={12}
          placeholder={placeholder}
          className="block w-full rounded-b px-3 py-2 font-mono text-xs outline-none"
        />
      )}
    </div>
  );
}

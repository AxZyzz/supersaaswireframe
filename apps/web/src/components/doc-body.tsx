import { Fragment } from "react";

/** Inline: **bold**, *italic*, `code`. Text only — never HTML. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold text-ink2">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} className="rounded bg-panel px-1 py-0.5 text-[0.92em] text-ink2">
          {p.slice(1, -1)}
        </code>
      );
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2)
      return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

/** Renders the tiny markup used in lib/docs.ts. */
export function DocBody({ body }: { body: string }) {
  const out: React.ReactNode[] = [];
  const lines = body.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      out.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-md border border-line bg-panel p-3 text-tiny leading-relaxed text-ink2"
        >
          {code.join("\n")}
        </pre>,
      );
    } else if (line.startsWith("## ")) {
      out.push(
        <h3 key={key++} className="pt-2 text-section font-semibold text-ink2">
          {line.slice(3)}
        </h3>,
      );
      i++;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      out.push(
        <ul key={key++} className="list-disc space-y-1.5 pl-5">
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </ul>,
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^(## |- |```)/.test(lines[i])
      )
        para.push(lines[i++]);
      out.push(<p key={key++}>{inline(para.join(" "))}</p>);
    }
  }
  return <div className="space-y-3 text-sm leading-relaxed text-ink">{out}</div>;
}

/**
 * Allowlist sanitizer for showing email HTML inside the app (template preview,
 * visual editor). Templates are written by teammates, so rendering them raw
 * would let one member run script in another's session. Scripts, event
 * handlers, iframes/forms and javascript: URLs are dropped; ordinary email
 * markup survives. Browser-only (uses DOMParser); returns '' on the server.
 *
 * This guards the app UI. Outbound mail is rendered server-side and never
 * executes in our origin.
 */

const TAGS = new Set([
  "a", "b", "blockquote", "br", "center", "code", "div", "em", "font", "h1",
  "h2", "h3", "h4", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "u", "ul",
]);

// Contents are removed entirely, not unwrapped.
const DROP = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button",
  "textarea", "select", "link", "meta", "base", "svg", "math", "template",
  "noscript", "frame", "frameset",
]);

const ATTRS = new Set([
  "href", "src", "alt", "title", "width", "height", "align", "valign",
  "colspan", "rowspan", "style", "target", "rel", "color", "bgcolor",
  "border", "cellpadding", "cellspacing",
]);

// {first_name} style tokens are allowed as link targets (merged at send time).
const SAFE_URL = /^(https?:|mailto:|tel:|#|\{\w+(\|[^}]*)?\})/i;

function cleanStyle(v: string): string {
  return /expression\s*\(|javascript:|url\s*\(/i.test(v) ? "" : v;
}

function clean(node: Element) {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) {
      child.remove();
      continue;
    }
    clean(child);
    if (!TAGS.has(tag)) {
      child.replaceWith(...Array.from(child.childNodes)); // unwrap
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (!ATTRS.has(name)) child.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && !SAFE_URL.test(value)) {
        child.removeAttribute(attr.name);
      } else if (name === "src" && !/^https?:/i.test(value)) {
        child.removeAttribute(attr.name);
      } else if (name === "style") {
        const s = cleanStyle(value);
        if (s) child.setAttribute("style", s);
        else child.removeAttribute("style");
      }
    }
  }
}

export function sanitizeEmailHtml(html: string): string {
  if (typeof window === "undefined" || !html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  clean(doc.body);
  return doc.body.innerHTML;
}

/** True when sanitizing would change the markup (the visual editor would
 *  silently drop something), comparing against the browser-normalized form. */
export function wouldLoseMarkup(html: string): boolean {
  if (typeof window === "undefined" || !html) return false;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return doc.body.innerHTML !== sanitizeEmailHtml(html);
}

/**
 * HTML artifacts: pages an agent publishes into a thread with the `html_render`
 * MCP tool. The server stores the page as a thread attachment and returns an
 * {@link HtmlRenderReference}; clients read it back from the tool result and
 * render the page in a sandboxed frame. The page talks to its host only
 * through the JSON-RPC messages below (size, theme, links).
 *
 * Ported from T3 Code's html_render, without server-side height measurement:
 * the client sizes the frame from the live page.
 */
import {
  E6_CODE_DARK_THEME_COLORS,
  E6_CODE_LIGHT_THEME_COLORS,
  type ThemeAppearance,
  type ThemeColors,
} from "./themePalettes.ts";

export const HTML_RENDER_TOOL_NAME = "html_render";
export const HTML_RENDER_MIN_HEIGHT = 80;
export const HTML_RENDER_MAX_HEIGHT = 2000;
// The frame follows the live page up to this height; it only stops a page that grows with its frame.
export const HTML_RENDER_MAX_FIT_HEIGHT = 20_000;
export const HTML_RENDER_MAX_TITLE_LENGTH = 200;
export const HTML_RENDER_MAX_HTML_LENGTH = 512_000;
const HTML_RENDER_COLUMN_WIDTH = 728;

export interface HtmlRenderReference {
  readonly attachmentId: string;
  readonly title: string;
  /** The agent's height hint, used until the live page reports its own. */
  readonly height: number;
}

export function clampHtmlRenderHeight(height: number): number {
  return Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.round(height)));
}

/** Validates an untrusted value, such as a tool result, as a reference. */
export function readHtmlRenderReference(value: unknown): HtmlRenderReference | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { attachmentId, title, height } = value as Record<string, unknown>;
  if (
    typeof attachmentId !== "string" ||
    !/^[a-z0-9_-]{1,256}$/i.test(attachmentId) ||
    !attachmentId.endsWith("-html") ||
    typeof title !== "string" ||
    typeof height !== "number" ||
    !Number.isFinite(height)
  ) {
    return undefined;
  }
  return {
    attachmentId,
    title: title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "HTML",
    height: clampHtmlRenderHeight(height),
  };
}

/** The live page's height wins over the agent's hint: client fonts often wrap it taller. */
export function htmlRenderFrameHeight(reference: HtmlRenderReference, contentHeight?: number) {
  if (contentHeight === undefined) return reference.height;
  return Math.min(
    HTML_RENDER_MAX_FIT_HEIGHT,
    Math.max(HTML_RENDER_MIN_HEIGHT, Math.ceil(contentHeight)),
  );
}

export function htmlRenderFileName(title: string) {
  const name = title
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${name || "Page"}.html`;
}

export const HTML_RENDER_THEME_GUIDE = [
  "Use theme CSS variables on :root, not fixed colors:",
  "--background, --foreground, --muted, --card, --popover, --secondary, --border, --ring, --primary, --accent, --destructive, --warning, --success, --info, --code-background",
  "(most have a matching -foreground; accent, destructive, and warning also have -surface),",
  "--chart-1 to --chart-6, --radius, --font-sans, --font-mono.",
  "The base sheet sets background, text, and font.",
].join(" ");

export const HTML_RENDER_LAYOUT_GUIDE = [
  `Frame width is reply width (${HTML_RENDER_COLUMN_WIDTH}px desktop, about 360px phones), on the thread background.`,
  "Leave html, body, and the outer element with no background color, no outer card, border, banner title, or side padding.",
  "E6 Code adds an overridable 8px html gutter for focus rings and shadows. Use fluid widths within it.",
  "A box that needs its own background gets 16px padding and var(--radius) corners. Give charts fixed pixel heights.",
  "Let content set the height. Do not use vh units or height:100% on html or body.",
].join(" ");

export interface HtmlRenderTheme {
  readonly appearance: ThemeAppearance;
  readonly variables: Readonly<Record<string, string>>;
}

const HTML_RENDER_FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  // Concrete names only: some engines alias `ui-monospace` to the proportional UI font.
  mono: '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

// Roles the app palette has no slot for. Chart hues follow the accent in --chart-1.
const FIXED_COLORS = {
  light: {
    success: "#10b981",
    successForeground: "#047857",
    info: "#3b82f6",
    infoForeground: "#1d4ed8",
    chart: ["#0d9488", "#d97706", "#9333ea", "#e11d48", "#65a30d"],
  },
  dark: {
    success: "#10b981",
    successForeground: "#34d399",
    info: "#3b82f6",
    infoForeground: "#60a5fa",
    chart: ["#2dd4bf", "#fbbf24", "#c084fc", "#fb7185", "#a3e635"],
  },
} as const;

/** Maps app theme roles to the variables a page uses; --accent is the brand color. */
export function htmlRenderTheme(colors: ThemeColors, appearance: ThemeAppearance): HtmlRenderTheme {
  const fixed = FIXED_COLORS[appearance];
  return {
    appearance,
    variables: {
      "--background": colors.canvas,
      "--foreground": colors.text,
      "--muted": colors.muted,
      "--muted-foreground": colors.mutedForeground,
      "--card": colors.surface,
      "--card-foreground": colors.text,
      "--popover": colors.surfaceOverlay,
      "--popover-foreground": colors.text,
      "--secondary": colors.secondary,
      "--secondary-foreground": colors.secondaryForeground,
      "--border": colors.border,
      "--input": colors.input,
      "--ring": colors.focus,
      "--primary": colors.messageAction,
      "--primary-foreground": colors.messageActionForeground,
      "--accent": colors.accent,
      "--accent-foreground": colors.accentForeground,
      "--accent-surface": colors.accentSurface,
      "--accent-surface-foreground": colors.accentSurfaceForeground,
      "--destructive": colors.error,
      "--destructive-foreground": colors.errorForeground,
      "--destructive-surface": colors.errorSurface,
      "--warning": colors.warning,
      "--warning-foreground": colors.warningForeground,
      "--warning-surface": colors.warningSurface,
      "--success": fixed.success,
      "--success-foreground": fixed.successForeground,
      "--info": fixed.info,
      "--info-foreground": fixed.infoForeground,
      "--code-background": colors.codeBackground,
      "--code-foreground": colors.codeForeground,
      "--chart-1": colors.accent,
      ...Object.fromEntries(fixed.chart.map((color, index) => [`--chart-${index + 2}`, color])),
      "--radius": "0.625rem",
      "--font-sans": HTML_RENDER_FONTS.sans,
      "--font-mono": HTML_RENDER_FONTS.mono,
    },
  };
}

// Method names follow MCP Apps so a later MCP Apps host can share the frame protocol.
const HOST_CONTEXT_CHANGED_METHOD = "ui/notifications/host-context-changed";
const OPEN_LINK_METHOD = "ui/open-link";
const SIZE_CHANGED_METHOD = "ui/notifications/size-changed";

export function readHtmlRenderContentHeight(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== SIZE_CHANGED_METHOD) return undefined;
  const height =
    typeof params === "object" && params !== null
      ? (params as { height?: unknown }).height
      : undefined;
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
}

/** Only http(s) links leave the frame; the host opens them outside the app. */
export function readHtmlRenderLinkRequest(data: unknown): { readonly url: string } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== OPEN_LINK_METHOD) return undefined;
  if (typeof params !== "object" || params === null) return undefined;
  const { url } = params as Record<string, unknown>;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? { url } : undefined;
}

export function htmlRenderThemeMessage(theme: HtmlRenderTheme) {
  return {
    jsonrpc: "2.0",
    method: HOST_CONTEXT_CHANGED_METHOD,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
  } as const;
}

const THEME_FRAGMENT_KEY = "e6-theme";

/** Lets the first paint use the client's theme; the bootstrap strips it from the URL. */
export function htmlRenderThemeFragment(theme: HtmlRenderTheme): string {
  return `#${THEME_FRAGMENT_KEY}=${encodeURIComponent(JSON.stringify(theme))}`;
}

const BASE_CSS =
  "html{box-sizing:border-box;padding:8px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}" +
  "html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}" +
  // Focus outlines paint inside the element, so the frame edge never clips them.
  ":where(:focus-visible){outline:2px solid var(--ring)}:focus-visible{outline-width:2px!important;outline-offset:-2px!important}";

function rootRule(theme: HtmlRenderTheme): string {
  const declarations = Object.entries(theme.variables)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `:root{color-scheme:${theme.appearance};${declarations}}`;
}

// Runs before the page's own head content. It applies the theme from the URL fragment or a host
// message, forwards http(s) link clicks to the host (framed) or opens them in a new tab (top level),
// and reports the document height so the host can fit the frame.
const BOOTSTRAP_SCRIPT = `(function(){
var style=document.getElementById("e6-theme");if(!style)return;
var base=${JSON.stringify(BASE_CSS)},framed=window.parent!==window;
function apply(t){if(!t||typeof t!=="object"||!t.variables||typeof t.variables!=="object")return;
var css=":root{color-scheme:"+(t.appearance==="light"?"light":"dark")+";";
for(var k in t.variables){if(/^--[a-z0-9-]+$/.test(k))css+=k+":"+String(t.variables[k]).replace(/[;{}<>]/g,"")+";";}
style.textContent=css+"}"+base;}
try{var m=/[#&]${THEME_FRAGMENT_KEY}=([^&]*)/.exec(location.hash);
if(m){apply(JSON.parse(decodeURIComponent(m[1])));history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}
window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;
if(e.source===window.parent&&d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(HOST_CONTEXT_CHANGED_METHOD)}&&p&&p.styles)apply({appearance:p.theme,variables:p.styles.variables});});
document.addEventListener("click",function(e){
var link=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,url;
if(!link)return;try{url=new URL(link.getAttribute("href"),document.baseURI);}catch(x){return;}
if(!/^https?:$/.test(url.protocol)||url.href.split("#")[0]===location.href.split("#")[0])return;
if(framed){e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(OPEN_LINK_METHOD)},params:{url:url.href}},"*");}
else{link.setAttribute("target","_blank");link.setAttribute("rel","noopener");}},true);
if(!framed)return;
var last,observer,report=function(){var r=document.documentElement,
h=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);
if(h===last)return;last=h;
window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED_METHOD)},params:{height:h}},"*");};
if(window.ResizeObserver){observer=new ResizeObserver(report);observer.observe(document.documentElement);}
document.addEventListener("DOMContentLoaded",function(){if(observer&&document.body)observer.observe(document.body);report();});
window.addEventListener("load",report);
})();`;

function bootstrapMarkup(markup: string): string {
  const dark = htmlRenderTheme(E6_CODE_DARK_THEME_COLORS, "dark");
  const light = htmlRenderTheme(E6_CODE_LIGHT_THEME_COLORS, "light");
  const defaultCss = `${rootRule(dark)}@media (prefers-color-scheme: light){${rootRule(light)}}${BASE_CSS}`;
  return [
    /<meta\s[^>]*charset/i.test(markup.slice(0, 4096)) ? "" : '<meta charset="utf-8">',
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(markup)
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="e6-theme">${defaultCss}</style>`,
    `<script>${BOOTSTRAP_SCRIPT}</script>`,
  ].join("");
}

// Blank inert content without shifting offsets, so tags inside comments, scripts, raw-text
// elements and templates cannot receive the bootstrap.
const blankNonMarkup = (html: string) => {
  const scan = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
    (match) => " ".repeat(match.length),
  );
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let at = 0;
  for (const match of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
    if (!match[1]) {
      if (depth++ === 0) start = match.index;
    } else if (depth > 0 && --depth === 0) {
      const end = match.index + match[0].length;
      parts.push(scan.slice(at, start), " ".repeat(end - start));
      at = end;
    }
  }
  if (depth > 0) {
    parts.push(scan.slice(at, start), " ".repeat(scan.length - start));
    at = scan.length;
  }
  parts.push(scan.slice(at));
  return parts.join("");
};

/** Puts the theme and bootstrap ahead of the page's own head content, wrapping fragments. */
export function injectHtmlRenderBootstrap(html: string): string {
  const scan = blankNonMarkup(html);
  const markup = bootstrapMarkup(scan);
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + markup + html.slice(at);
  }
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype[0].length;
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
  }
  return `<!doctype html><head>${markup}</head>${html}`;
}

// The lookbehind skips base64 runs, such as an inlined image that happens to contain "1vh".
const VIEWPORT_HEIGHT_UNIT = /(?<![\w.+/])(?:\d+(?:\.\d+)?|\.\d+)[sld]?vh(?![\w-])/i;
const CSS_SOURCE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>|\bstyle\s*=\s*("[^"]*"|'[^']*')/gi;

/**
 * A frame that fits its page loops when the page sizes itself from the frame, so pages using vh
 * units in CSS are refused. Returns the first offending unit, or undefined.
 */
export function findHtmlRenderViewportHeightUnit(html: string): string | undefined {
  for (const match of html.matchAll(CSS_SOURCE)) {
    const found = VIEWPORT_HEIGHT_UNIT.exec(match[1] ?? match[2] ?? "")?.[0];
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Pages each turn published, in order and once each, read from thread activities whose payload
 * carries the server-projected `htmlRender` reference. Clients without the web work log use this.
 */
export function htmlRendersByTurnId<TurnKey extends string>(
  activities: ReadonlyArray<{ readonly turnId: TurnKey | null; readonly payload: unknown }>,
): ReadonlyMap<TurnKey, ReadonlyArray<HtmlRenderReference>> {
  const byTurnId = new Map<TurnKey, HtmlRenderReference[]>();
  for (const activity of activities) {
    if (activity.turnId === null || typeof activity.payload !== "object" || !activity.payload) {
      continue;
    }
    const reference = readHtmlRenderReference(
      (activity.payload as { readonly htmlRender?: unknown }).htmlRender,
    );
    if (!reference) continue;
    const renders = byTurnId.get(activity.turnId) ?? [];
    if (!renders.some((render) => render.attachmentId === reference.attachmentId)) {
      renders.push(reference);
    }
    byTurnId.set(activity.turnId, renders);
  }
  return byTurnId;
}

// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { HighlighterCore } from "shiki/core";

/**
 * YAML syntax highlighting for the detail view. The shiki core, the JavaScript
 * regex engine, and the single YAML grammar all load lazily with the detail
 * chunk — nothing here is reachable from the main bundle. Colors ship as
 * --shiki-light/--shiki-dark custom properties; styles.css picks per theme.
 */

let highlighterPromise: Promise<HighlighterCore> | undefined;

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/langs/yaml.mjs"),
    import("shiki/themes/github-light.mjs"),
    import("shiki/themes/github-dark.mjs"),
  ]).then(([core, engine, yaml, light, dark]) =>
    core.createHighlighterCore({
      langs: [yaml.default],
      themes: [light.default, dark.default],
      engine: engine.createJavaScriptRegexEngine(),
    }),
  );
  return highlighterPromise;
}

export async function highlightYaml(code: string): Promise<string> {
  const highlighter = await loadHighlighter();
  return highlighter.codeToHtml(code, {
    lang: "yaml",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

export function useYamlHighlight(code: string | undefined): string | undefined {
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    if (code === undefined) {
      setHtml(undefined);
      return;
    }
    let cancelled = false;
    setHtml(undefined);
    highlightYaml(code)
      .then((next) => { if (!cancelled) setHtml(next); })
      .catch(() => { if (!cancelled) setHtml(undefined); });
    return () => { cancelled = true; };
  }, [code]);
  return html;
}

export function HighlightedYaml({ code, className, testId, ariaLabel }: {
  code: string;
  className: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const html = useYamlHighlight(code);
  if (!html) {
    return (
      <pre className={className} data-testid={testId} aria-label={ariaLabel}>
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <div
      className={`${className} shiki-host`}
      data-testid={testId}
      aria-label={ariaLabel}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

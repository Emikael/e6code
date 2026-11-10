import { Suspense, useState } from "react";

import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { MermaidDiagram } from "../chat/MermaidDiagram";
import { RenderErrorBoundary } from "../RenderErrorBoundary";

// Pele lays out DOM before sanitizing its SVG. Refuse resource and config syntax before that pass
// so a standalone file cannot initiate requests. Node metadata is YAML, whose escaped or aliased
// image keys cannot be checked lexically. (Ported from T3 Code.)
const UNSAFE_DIAGRAM_SOURCE =
  /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file):/im;

export function isUnsafeMermaidFileSource(text: string): boolean {
  return UNSAFE_DIAGRAM_SOURCE.test(text);
}

export default function MermaidViewer(props: { readonly text: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (isUnsafeMermaidFileSource(props.text))
    return (
      <div role="alert" className="p-6 text-xs text-muted-foreground">
        This diagram contains resource URLs, markup, node metadata, or custom configuration. Show
        the Mermaid source to inspect it safely.
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <RenderErrorBoundary
        resetKeys={[props.text]}
        fallback={<pre className="font-mono text-xs whitespace-pre-wrap">{props.text}</pre>}
      >
        <Suspense fallback={null}>
          <MermaidDiagram source={props.text} onExpand={setExpanded} />
        </Suspense>
      </RenderErrorBoundary>
      {expanded ? (
        <ExpandedImageDialog
          preview={{ images: [{ src: expanded, name: "Mermaid diagram" }], index: 0 }}
          onClose={() => setExpanded(null)}
        />
      ) : null}
    </div>
  );
}

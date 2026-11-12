import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

/**
 * A hidden reference cannot be seen, so it must not be deleted unseen either: typing over or
 * deleting across one puts it back where it was. Attached items are removed from the composer's
 * attached row. Controlled updates from the draft (setContent) are left alone.
 */
export function keepHiddenReferencesPlugin(isHidden: (kind: string, contextId: string) => boolean) {
  return new Plugin({
    key: new PluginKey("composer-keep-hidden-references"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta("preventUpdate") === true)) return null;
      const present = new Set<string>();
      newState.doc.descendants((node) => {
        if (node.type.name === "composer-context-reference") {
          present.add(node.attrs.contextId as string);
        }
      });
      const lost: Array<{ pos: number; node: ProseMirrorNode }> = [];
      oldState.doc.descendants((node, pos) => {
        if (node.type.name !== "composer-context-reference") return;
        const contextId = node.attrs.contextId as string;
        if (!present.has(contextId) && isHidden(node.attrs.kind as string, contextId)) {
          lost.push({ pos, node });
        }
      });
      if (lost.length === 0) return null;
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      const tr = newState.tr;
      for (const { pos, node } of lost) {
        let at = tr.mapping.map(mapping.map(pos, -1), -1);
        if (!tr.doc.resolve(at).parent.inlineContent) {
          // The block it sat in is gone: end of the last textblock instead.
          let end = -1;
          tr.doc.descendants((block, blockPos) => {
            if (block.isTextblock) end = blockPos + block.nodeSize - 1;
          });
          if (end < 0) continue;
          at = end;
        }
        tr.insert(at, node);
      }
      return tr.docChanged ? tr : null;
    },
  });
}

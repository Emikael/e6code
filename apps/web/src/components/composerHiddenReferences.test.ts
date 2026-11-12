import { type Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vite-plus/test";

import { keepHiddenReferencesPlugin } from "./composerHiddenReferences";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    "composer-context-reference": {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { kind: { default: "" }, contextId: { default: "" } },
    },
  },
});

const reference = (kind: string, contextId: string) =>
  schema.nodes["composer-context-reference"]!.create({ kind, contextId });

const plugin = keepHiddenReferencesPlugin((kind) => kind === "terminal");

function stateWith(...inline: ProseMirrorNode[]) {
  return EditorState.create({
    schema,
    plugins: [plugin],
    doc: schema.node("doc", null, [schema.node("paragraph", null, inline)]),
  });
}

const referenceIds = (state: EditorState) => {
  const ids: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === "composer-context-reference") ids.push(node.attrs.contextId as string);
  });
  return ids;
};

describe("hidden attached references in the prompt", () => {
  it("survive deleting the whole prompt, while a visible chip goes", () => {
    const state = stateWith(
      schema.text("fix "),
      reference("terminal", "t1"),
      schema.text(" and "),
      reference("file", "f1"),
    );
    const all = state.tr.setSelection(
      TextSelection.create(state.doc, 1, state.doc.content.size - 1),
    );
    const next = state.applyTransaction(all.deleteSelection()).state;
    expect(referenceIds(next)).toEqual(["t1"]);
    expect(next.doc.textContent).toBe("");
  });

  it("are removed by a controlled update from the draft", () => {
    const state = stateWith(schema.text("fix "), reference("terminal", "t1"));
    const tr = state.tr.delete(5, 6).setMeta("preventUpdate", true);
    expect(referenceIds(state.applyTransaction(tr).state)).toEqual([]);
  });
});

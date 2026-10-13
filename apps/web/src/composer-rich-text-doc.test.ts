import { Editor, getSchemaByResolvedExtensions, Node, resolveExtensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDocJson,
  collapsedToFlat,
  ComposerCodeExtension,
  ComposerStarterKit,
  ComposerTaskItemExtension,
  flatToCollapsed,
  flatToMarkdown,
  flatToPm,
  pmToFlat,
  serializeEditorDoc,
} from "./composer-rich-text-doc";

function stubAtom(name: string, attrs: Record<string, { default: unknown }>) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => attrs,
  });
}

const schema = getSchemaByResolvedExtensions(
  resolveExtensions([
    ComposerStarterKit.configure({
      blockquote: false,
      bulletList: false,
      codeBlock: { exitOnArrowUp: false },
      heading: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      code: false,
    }),
    ComposerCodeExtension,
    stubAtom("composer-mention", { path: { default: "" }, source: { default: "" } }),
    stubAtom("composer-skill", {
      skillName: { default: "" },
      skillLabel: { default: "" },
      skillDescription: { default: null },
    }),
    stubAtom("composer-citation", {
      citation: { default: null },
      source: { default: "" },
      citeKey: { default: "" },
    }),
    stubAtom("composer-context-reference", {
      kind: { default: "" },
      contextId: { default: "" },
      label: { default: "" },
      source: { default: "" },
    }),
    TaskList,
    ComposerTaskItemExtension,
  ]),
);

function roundTrip(value: string) {
  const json = buildDocJson(value, (name) => ({ label: name, description: null }));
  const doc = ProseMirrorNode.fromJSON(schema, json);
  // `insertContent` validates every node against the schema; `fromJSON` does not.
  doc.check();
  return serializeEditorDoc(doc);
}

// Plain mode: the same engine with the mark extensions off. Markers stay
// literal characters and task lines stay paragraphs.
const plainSchema = getSchemaByResolvedExtensions(
  resolveExtensions([
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
    }),
    stubAtom("composer-mention", { path: { default: "" }, source: { default: "" } }),
    stubAtom("composer-skill", {
      skillName: { default: "" },
      skillLabel: { default: "" },
      skillDescription: { default: null },
    }),
    stubAtom("composer-citation", {
      citation: { default: null },
      source: { default: "" },
      citeKey: { default: "" },
    }),
    stubAtom("composer-context-reference", {
      kind: { default: "" },
      contextId: { default: "" },
      label: { default: "" },
      source: { default: "" },
    }),
    TaskList,
    ComposerTaskItemExtension,
  ]),
);

function roundTripPlain(value: string) {
  const json = buildDocJson(value, (name) => ({ label: name, description: null }), {
    styling: false,
  });
  const doc = ProseMirrorNode.fromJSON(plainSchema, json);
  return serializeEditorDoc(doc);
}

function editableDoc(value: string) {
  const editor = new Editor({
    element: null,
    extensions: [
      ComposerStarterKit.configure({
        codeBlock: { exitOnArrowUp: false },
        trailingNode: false,
        gapcursor: false,
        dropcursor: false,
      }),
    ],
    content: buildDocJson(value, (name) => ({ label: name, description: null })),
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

function pressEditorKey(editor: Editor, key: string, shiftKey = false) {
  const event = { key, shiftKey, metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent;
  return editor.state.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, editor.view, event),
  );
}

describe("composer code-block editing", () => {
  it("creates code on an otherwise empty midprompt line", () => {
    const editor = editableDoc("before\n``");
    const position = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(position);
    expect(
      editor.state.plugins.some((plugin) =>
        plugin.props.handleTextInput?.call(
          plugin,
          editor.view,
          position,
          position,
          "`",
          () => editor.state.tr,
        ),
      ),
    ).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe("before");
    expect(editor.state.doc.lastChild?.type.name).toBe("codeBlock");
    expect(serializeEditorDoc(editor.state.doc).value).toBe("before\n```\n\n```");
    editor.destroy();
  });

  it("turns the third backtick into an editable code block and supports undo", () => {
    const editor = editableDoc("``");
    editor.commands.setTextSelection(3);
    const handled = editor.state.plugins.some((plugin) =>
      plugin.props.handleTextInput?.call(plugin, editor.view, 3, 3, "`", () => editor.state.tr),
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock");
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    expect(serializeEditorDoc(editor.state.doc).value).toBe("```\n\n```");
    expect(editor.commands.undoInputRule()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(serializeEditorDoc(editor.state.doc).value).toBe("```");
    editor.destroy();
  });

  it("leaves three backticks inline or before existing text literal", () => {
    for (const [value, position] of [
      ["text ``", 8],
      ["``tail", 3],
    ] as const) {
      const editor = editableDoc(value);
      editor.commands.setTextSelection(position);
      const handled = editor.state.plugins.some((plugin) =>
        plugin.props.handleTextInput?.call(
          plugin,
          editor.view,
          position,
          position,
          "`",
          () => editor.state.tr,
        ),
      );
      expect(handled).toBe(false);
      expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
      editor.destroy();
    }
  });

  it("keeps Enter and Shift+Enter in code, then exits on the third Enter", () => {
    const editor = editableDoc("```ts\n雪 👋\n```");
    editor.commands.setTextSelection(1 + "雪 👋".length);
    expect(pressEditorKey(editor, "Enter")).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    expect(pressEditorKey(editor, "Enter", true)).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe("雪 👋\n\n");
    expect(pressEditorKey(editor, "Enter")).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe("雪 👋");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(serializeEditorDoc(editor.state.doc).value).toBe("```ts\n雪 👋\n```\n");
    editor.destroy();
  });

  it.each(["```\nx\n```", "```\nx\n```\nafter"])(
    "exits code with ArrowDown at its end: %j",
    (value) => {
      const editor = editableDoc(value);
      editor.commands.setTextSelection(2);
      expect(pressEditorKey(editor, "ArrowDown")).toBe(true);
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
      editor.destroy();
    },
  );

  it("turns an empty code block back into a paragraph with Backspace", () => {
    const editor = editableDoc("```\n```");
    expect(pressEditorKey(editor, "Backspace")).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(serializeEditorDoc(editor.state.doc).value).toBe("");
    editor.destroy();
  });

  it.each(["ArrowDown", "Enter"])(
    "closes an unfinished fence only when explicitly exiting with %s",
    (key) => {
      const editor = editableDoc("~~~~ts\n雪 👋");
      editor.commands.setTextSelection(1 + "雪 👋".length);
      expect(serializeEditorDoc(editor.state.doc).value).toBe("~~~~ts\n雪 👋");
      if (key === "Enter") {
        pressEditorKey(editor, "Enter");
        pressEditorKey(editor, "Enter");
      }
      expect(pressEditorKey(editor, key)).toBe(true);
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
      expect(serializeEditorDoc(editor.state.doc).value).toBe("~~~~ts\n雪 👋\n~~~~\n");
      editor.destroy();
    },
  );
});

describe("composer rich text document model", () => {
  it.each([
    "```ts\nconst price = '$review'; // @README.md\n```",
    "before\n  ````ts extra  \n雪 👋 **literal**\n  ````` \nafter",
    "~~~sh\necho $review\n~~~",
    "```ts\nunfinished 👋\n",
    "```",
    "```\n```",
  ])("retains editable fenced code and its exact Markdown for %j", (value) => {
    const json = buildDocJson(value, (name) => ({ label: name, description: null }));
    expect(json.content.some((block) => block.type === "codeBlock")).toBe(true);
    expect(roundTrip(value).value).toBe(value);
    expect(roundTripPlain(value).value).toBe(value);
    expect(roundTrip(roundTripPlain(roundTrip(value).value).value).value).toBe(value);
  });

  it("preserves code language and copies a code selection as fenced Markdown", () => {
    const value = "before\n````typescript extra\n雪 👋 **literal**\n````\nafter";
    const json = buildDocJson(value, (name) => ({ label: name, description: null }));
    expect(json.content[1]).toEqual({
      type: "codeBlock",
      attrs: { language: "typescript extra", opening: "````typescript extra\n", closing: "\n````" },
      content: [{ type: "text", text: "雪 👋 **literal**" }],
    });
    const doc = ProseMirrorNode.fromJSON(schema, json);
    const code = serializeEditorDoc(doc).runs.find((run) => run.kind === "code")!;
    const copied = doc.slice(code.pmPos - 1, code.pmPos + code.docLen + 1);
    expect(serializeEditorDoc(doc.type.create(null, copied.content)).value).toBe(
      "````typescript extra\n雪 👋 **literal**\n````",
    );
    const text = doc.slice(code.pmPos, code.pmPos + code.docLen).content;
    expect(
      serializeEditorDoc(doc.type.create(null, schema.nodes.paragraph!.create(null, text))).value,
    ).toBe("雪 👋 **literal**");
  });

  it("leaves fences editable as ordinary text when rich styling is off", () => {
    expect(
      buildDocJson("```", (name) => ({ label: name, description: null }), { styling: false }),
    ).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "```" }] }],
    });
  });

  it("maps a midprompt Unicode code selection to the same Markdown range", () => {
    const value = "before\n```ts\n雪 👋 literal\n```\nafter";
    const map = roundTrip(value);
    const start = value.indexOf("雪");
    const code = map.runs.find((run) => run.mdStart === start);
    expect(code).toBeDefined();
    const flatStart = code!.flatStart;
    for (let offset = 0; offset <= "雪 👋 literal".length; offset += 1) {
      expect(flatToMarkdown(map, flatStart + offset)).toBe(start + offset);
      expect(flatToCollapsed(map, flatStart + offset)).toBe(start + offset);
      expect(collapsedToFlat(map, start + offset)).toBe(flatStart + offset);
      expect(pmToFlat(map, flatToPm(map, flatStart + offset))).toBe(flatStart + offset);
    }
  });

  it.each(["€", "£", "¥", "₹", "₩", "₿", "𑿝"])(
    "canonicalizes %s skill aliases while preserving amounts",
    (prefix) => {
      const value = `Use ${prefix}my-skill for ${prefix}20 please`;
      const expected = `Use $my-skill for ${prefix}20 please`;
      expect(roundTrip(value).value).toBe(expected);
      expect(roundTripPlain(value).value).toBe(expected);
    },
  );

  it.each([
    "",
    "\n\n",
    "plain text",
    "hello **bold** world",
    "a *italic* word and `code` here",
    "struck ~~out~~ now",
    "**`x`**",
    "*`x`*",
    "~~`x`~~",
    "**a `code` c**",
    "***bold italic*** keeps nesting",
    "line one\nline two",
    "trailing newline\n",
    "1. foo\n2. asdf\n",
    "- [ ] buy milk",
    "-   [ ]  buy milk",
    "\t-\t[x]\t\titem",
    "- [ ]  ",
    "- [ ]\n  - [ ] child",
    "  - [ ] first\n - [ ] second\n  - [ ] child",
    "**before @README.md after**",
    "*a **b** c*",
    "*a**b***",
    "**a*b***",
    "**a *b* c**",
    "literal \uFFFC **before @README.md after**",
    "- [x] done\n- [ ] next",
    "- [ ] parent\n  - [ ] child\n  - [ ] sibling\n- [ ] uncle",
    "- [ ] empty task follows\n- [ ]",
    "- [ ] **bold** task with @README.md",
    "para\n- [ ] task\npara",
    "- [ ]No space stays literal",
    "-[ ] also literal",
    "@README.md explain this",
    '@"docs/My File.md" and $my-skill please',
    "snake_case stays literal",
    "unmatched ** stays literal",
    "**bold** then @README.md then *italic*",
  ])("round-trips %s through a real ProseMirror document", (value) => {
    expect(roundTrip(value).value).toBe(value);
  });

  it.each([
    "",
    "\n",
    "text\n\n",
    "- [ ]\n- [ ] next\n",
    "- [ ] parent\n  - [ ] child\n- [ ]",
    "para\n- [ ] task\npara",
    "**before @README.md after**",
  ])("maps editable positions in %s", (value) => {
    const doc = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson(value, (name) => ({ label: name, description: null })),
    );
    const map = serializeEditorDoc(doc);
    for (let flat = 0; flat <= map.docLength; flat += 1) {
      const position = flatToPm(map, flat);
      expect(doc.resolve(position).parent.isTextblock).toBe(true);
      expect(pmToFlat(map, position)).toBe(flat);
      expect(collapsedToFlat(map, flatToCollapsed(map, flat))).toBe(flat);
    }
  });

  it("keeps the caret after a trailing hard break inside the same paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a"), schema.node("hardBreak")]),
    ]);
    const map = serializeEditorDoc(doc);
    expect(flatToPm(map, map.docLength)).toBe(3);
    expect(doc.resolve(flatToPm(map, map.docLength)).parent.isTextblock).toBe(true);
  });

  it("renders a leading task dedent as siblings and nests under the new indent", () => {
    const doc = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson("  - [ ] first\n - [ ] second\n  - [ ] child", (name) => ({
        label: name,
        description: null,
      })),
    );
    const list = doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.child(0).childCount).toBe(1);
    expect(list.child(1).child(1).firstChild!.textContent).toBe("child");
  });

  it("applies a shared mark to text on both sides of a chip", () => {
    const doc = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson("**before @README.md after**", (name) => ({ label: name, description: null })),
    );
    expect(doc.firstChild!.childCount).toBe(3);
    doc.firstChild!.forEach((child) =>
      expect(child.marks.map((mark) => mark.type.name)).toContain("bold"),
    );
    expect(serializeEditorDoc(doc).value).toBe("**before @README.md after**");
  });

  it.each([
    [["bold"], ["bold", "italic"], ["italic"]],
    [["italic"], ["bold", "italic"], ["bold"]],
    [["bold"], ["bold", "strike"], ["strike"]],
    [["strike"], ["bold", "strike"], ["bold"]],
  ])("preserves crossing mark ranges %j through controlled rebuilds", (...marks) => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        marks.map((names, index) =>
          schema.text(
            String.fromCharCode(97 + index),
            names.map((name) => schema.mark(name)),
          ),
        ),
      ),
    ]);
    const serialized = serializeEditorDoc(doc).value;
    const rebuilt = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson(serialized, (name) => ({ label: name, description: null })),
    );
    expect(rebuilt.eq(doc)).toBe(true);
    expect(serializeEditorDoc(rebuilt).value).toBe(serialized);
  });

  it.each([
    { parts: [{ text: "hello ", marks: ["bold"] }], expected: "**hello** " },
    { parts: [{ text: "  ", marks: ["bold"] }], expected: "  " },
    { parts: [{ text: " left ", marks: ["bold", "italic"] }], expected: " ***left*** " },
    {
      parts: [
        { text: "one ", marks: ["bold"] },
        { text: " two ", marks: ["bold", "italic"] },
        { text: " three", marks: ["bold"] },
      ],
      expected: "**one  *two*  three**",
    },
    {
      parts: [
        { text: "hello ", marks: ["bold"] },
        { text: "world ", marks: ["bold", "italic"] },
      ],
      expected: "**hello *world*** ",
    },
    { parts: [{ text: " hello ", marks: ["code"] }], expected: "` hello `" },
    { parts: [{ text: " hello ", marks: ["bold", "code"] }], expected: "**` hello `**" },
    { parts: [{ text: " ", marks: ["bold", "code"] }], expected: "**` `**" },
  ])("keeps boundary whitespace outside emphasis in $expected", ({ parts, expected }) => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        parts.map(({ text, marks }) =>
          schema.text(
            text,
            marks.map((name) => schema.mark(name)),
          ),
        ),
      ),
    ]);
    const map = serializeEditorDoc(doc);
    expect(map.value).toBe(expected);
    const rebuilt = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson(map.value, (name) => ({ label: name, description: null })),
    );
    expect(rebuilt.textContent).toBe(doc.textContent);
    expect(serializeEditorDoc(rebuilt).value).toBe(map.value);
    for (let flat = 0; flat <= map.docLength; flat += 1) {
      expect(pmToFlat(map, flatToPm(map, flat))).toBe(flat);
      expect(collapsedToFlat(map, flatToCollapsed(map, flat))).toBe(flat);
      if (flat < map.docLength && !/\s/.test(doc.textContent[flat]!)) {
        expect(rebuilt.resolve(flat + 1).nodeAfter!.marks.map((mark) => mark.type.name)).toEqual(
          doc.resolve(flat + 1).nodeAfter!.marks.map((mark) => mark.type.name),
        );
      }
    }
  });

  it("keeps chip sources canonical through the document", () => {
    const map = roundTrip("explain @README.md with **care**\nsecond line *here*");
    expect(map.value).toBe("explain @README.md with **care**\nsecond line *here*");
    expect(
      map.runs.some((run) => run.kind === "token" && run.nodeName === "composer-mention"),
    ).toBe(true);
  });

  it("normalizes uppercase checkboxes to lowercase", () => {
    expect(roundTrip("- [X] done").value).toBe("- [x] done");
  });

  it.each([
    "plain text",
    "hello **bold** stays literal",
    "a *italic* stays literal",
    "some `code` stays literal",
    "struck ~~out~~ stays literal",
    "- [ ] stays a paragraph",
    "- [x] stays a paragraph",
    "line one\nline two",
    "@README.md explain this",
    "**bold** then @README.md then *italic*",
  ])("round-trips %s byte-identically in plain mode", (value) => {
    expect(roundTripPlain(value).value).toBe(value);
  });

  it("maps every document offset through collapsed coordinates and back", () => {
    const value = "hi **bold** @README.md bye";
    const map = roundTrip(value);
    expect(map.value).toBe(value);
    for (let flat = 0; flat <= map.docLength; flat += 1) {
      expect(collapsedToFlat(map, flatToCollapsed(map, flat))).toBe(flat);
    }
  });

  it("maps markdown offsets at styled edges onto document text", () => {
    const value = "a **bold** c";
    const map = roundTrip(value);
    expect(map.value).toBe(value);
    // document text is "a bold c" (flat), markdown has the markers.
    expect(flatToMarkdown(map, 2)).toBe(4);
    expect(flatToMarkdown(map, 6)).toBe(10);
    expect(collapsedToFlat(map, 3)).toBe(2);
    expect(collapsedToFlat(map, 9)).toBe(6);
  });
});

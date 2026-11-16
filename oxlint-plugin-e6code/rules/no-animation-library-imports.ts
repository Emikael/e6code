import { defineRule } from "@oxlint/plugins";

/**
 * Animation engines reach feature code only through `apps/web/src/next/motion`, which applies
 * MotionPolicy. Files that may name an engine get it through the `allow` option in an
 * override, so the grant is visible next to the path it applies to.
 */
const ENGINE_PACKAGES = [
  "motion",
  "framer-motion",
  "motion-dom",
  "motion-utils",
  "gsap",
  "@gsap/react",
  "animejs",
] as const;

/** The engine package a specifier names: exactly, or as `package/subpath`. */
const enginePackageOf = (specifier: string) =>
  ENGINE_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));

/** A string literal, or a template literal with no expressions (`import(\`gsap\`)`). */
const literalStringValue = (node: unknown): string | undefined => {
  if (typeof node !== "object" || node === null || !("type" in node)) return undefined;
  if (node.type === "Literal") {
    return "value" in node && typeof node.value === "string" ? node.value : undefined;
  }
  if (node.type !== "TemplateLiteral") return undefined;
  if (!("expressions" in node) || !Array.isArray(node.expressions)) return undefined;
  if (node.expressions.length > 0 || !("quasis" in node) || !Array.isArray(node.quasis)) {
    return undefined;
  }
  const cooked: unknown = node.quasis[0]?.value?.cooked;
  return typeof cooked === "string" ? cooked : undefined;
};

const readAllow = (options: ReadonlyArray<unknown>): ReadonlySet<string> => {
  const first = options[0];
  if (typeof first !== "object" || first === null || !("allow" in first)) return new Set();
  const allow = first.allow;
  return new Set(
    Array.isArray(allow) ? allow.filter((name): name is string => typeof name === "string") : [],
  );
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Import animation engines (motion, gsap, animejs) only through the next/motion layer.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "array",
            items: { type: "string", enum: [...ENGINE_PACKAGES] },
            description: "Engine packages this file may import, granted per path in an override.",
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allow: [] }],
  },
  create(context) {
    const allow = readAllow(context.options);
    /** The engine `sourceNode` names when this file is not granted it. */
    const bannedEngine = (sourceNode: unknown) => {
      const source = literalStringValue(sourceNode);
      const engine = source === undefined ? undefined : enginePackageOf(source);
      return engine === undefined || allow.has(engine) ? undefined : engine;
    };
    const message = (engine: string) =>
      `Do not import ${engine} here. Animate through apps/web/src/next/motion, which applies MotionPolicy.`;

    return {
      ImportDeclaration(node) {
        const engine = bannedEngine(node.source);
        if (engine !== undefined) context.report({ node, message: message(engine) });
      },
      ExportAllDeclaration(node) {
        const engine = bannedEngine(node.source);
        if (engine !== undefined) context.report({ node, message: message(engine) });
      },
      ExportNamedDeclaration(node) {
        const engine = bannedEngine(node.source);
        if (engine !== undefined) context.report({ node, message: message(engine) });
      },
      ImportExpression(node) {
        const engine = bannedEngine(node.source);
        if (engine !== undefined) context.report({ node, message: message(engine) });
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const engine = bannedEngine(node.arguments[0]);
        if (engine !== undefined) context.report({ node, message: message(engine) });
      },
    };
  },
});

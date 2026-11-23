import { defineRule } from "@oxlint/plugins";

import { literalStringValue, readAllow } from "../utils.ts";

/**
 * Icon libraries reach v2 code only through the icon layer: `apps/web/src/next/icons` on web,
 * whose generated components are plain SVG, and `AppSymbol` on mobile. A file that must name a
 * library gets it through the `allow` option in an override, so the grant sits next to its path.
 */
const ICON_PACKAGES = [
  "lucide",
  "lucide-react",
  "morphicons",
  "@phosphor-icons/core",
  "@phosphor-icons/react",
  "@phosphor-icons/web",
  "phosphor-react",
  "phosphor-react-native",
  "@tabler/icons",
  "@tabler/icons-react",
  "@tabler/icons-react-native",
] as const;

/** The icon package a specifier names: exactly, or as `package/subpath`. */
const iconPackageOf = (specifier: string) =>
  ICON_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Import icon libraries (Lucide, Phosphor, Tabler, morphicons) only through the icon layer.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "array",
            items: { type: "string", enum: [...ICON_PACKAGES] },
            description: "Icon packages this file may import, granted per path in an override.",
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allow: [] }],
  },
  create(context) {
    const allow = readAllow(context.options);
    /** The icon package `sourceNode` names when this file is not granted it. */
    const bannedPackage = (sourceNode: unknown) => {
      const source = literalStringValue(sourceNode);
      const name = source === undefined ? undefined : iconPackageOf(source);
      return name === undefined || allow.has(name) ? undefined : name;
    };
    const message = (name: string) =>
      `Do not import ${name} here. Draw icons through the icon layer: apps/web/src/next/icons on web, AppSymbol on mobile.`;

    return {
      ImportDeclaration(node) {
        const name = bannedPackage(node.source);
        if (name !== undefined) context.report({ node, message: message(name) });
      },
      ExportAllDeclaration(node) {
        const name = bannedPackage(node.source);
        if (name !== undefined) context.report({ node, message: message(name) });
      },
      ExportNamedDeclaration(node) {
        const name = bannedPackage(node.source);
        if (name !== undefined) context.report({ node, message: message(name) });
      },
      ImportExpression(node) {
        const name = bannedPackage(node.source);
        if (name !== undefined) context.report({ node, message: message(name) });
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const name = bannedPackage(node.arguments[0]);
        if (name !== undefined) context.report({ node, message: message(name) });
      },
    };
  },
});

import type { ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

type ExpressionWrapper =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion;

type AstNode = ESTree.Node;

const asAstNode = (node: unknown): Option.Option<AstNode> =>
  typeof node === "object" && node !== null && "type" in node && typeof node.type === "string"
    ? Option.some(node as AstNode)
    : Option.none();

const isExpressionWrapper = (node: AstNode): node is ExpressionWrapper =>
  node.type === "ChainExpression" ||
  node.type === "ParenthesizedExpression" ||
  node.type === "TSNonNullExpression" ||
  node.type === "TSAsExpression" ||
  node.type === "TSTypeAssertion";

export function unwrapExpression(node: unknown): Option.Option<AstNode> {
  let current = asAstNode(node);

  while (Option.isSome(current) && isExpressionWrapper(current.value)) {
    current = asAstNode(current.value.expression);
  }

  return current;
}

export function getPropertyName(node: unknown): Option.Option<string> {
  return Option.flatMap(asAstNode(node), (expression) => {
    if (expression.type === "Identifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "PrivateIdentifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "Literal" && typeof expression.value === "string") {
      return Option.some(expression.value);
    }
    return Option.none();
  });
}

export function isIdentifier(node: Option.Option<AstNode>, name?: string): boolean {
  if (Option.isNone(node)) return false;
  const expression = node.value;
  return (
    expression.type === "Identifier" &&
    typeof expression.name === "string" &&
    (name === undefined || expression.name === name)
  );
}

/** A string literal, or a template literal with no expressions (`import(\`gsap\`)`). */
export const literalStringValue = (node: unknown): string | undefined => {
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

/** The package names an override grants through `{ allow: [...] }`, the rule's first option. */
export const readAllow = (options: ReadonlyArray<unknown>): ReadonlySet<string> => {
  const first = options[0];
  if (typeof first !== "object" || first === null || !("allow" in first)) return new Set();
  const allow = first.allow;
  return new Set(
    Array.isArray(allow) ? allow.filter((name): name is string => typeof name === "string") : [],
  );
};

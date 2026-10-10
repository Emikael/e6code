import { findEsmImportsOfExternalPackages } from "./cli-executable-imports.ts";
import { isRuntimeExternalCliDependency } from "./cli-external-packages.ts";

/**
 * Scan an emitted bundle chunk for bare imports that will fail at runtime.
 *
 * The bundler leaves a dependency external when it cannot resolve it — a
 * stale install after a lockfile change ships exactly this — and only warns.
 * Every bare import the bundle keeps must therefore be a runtime external with
 * its closure staged beside the backend; anything else dies with
 * ERR_MODULE_NOT_FOUND as soon as the packaged backend boots.
 *
 * Lives apart from `cli-external-packages.ts` because that module is the
 * bundler predicate imported by the server pack config. This scan parses each
 * chunk with the TypeScript compiler, which that config does not need.
 */
export function findUnexpectedExternalBundleImports(source: string): ReadonlyArray<string> {
  return findEsmImportsOfExternalPackages(source).filter(
    (specifier) => !isRuntimeExternalCliDependency(specifier),
  );
}

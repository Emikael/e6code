import { createParkedEnvironmentAtoms } from "@e6tools/client-runtime/state/parked";

import { connectionAtomRuntime } from "../connection/runtime";

export const parkedEnvironment = createParkedEnvironmentAtoms(connectionAtomRuntime);

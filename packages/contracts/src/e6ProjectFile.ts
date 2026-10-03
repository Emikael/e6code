import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ThreadEnvMode } from "./environment.ts";
import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in E6 project file, resolved at the workspace root. */
export const E6_PROJECT_FILE_NAME = "e6.json";

/** Previous project file name. Readers still load it when `e6.json` is absent. */
export const LEGACY_E6_PROJECT_FILE_NAME = "e6.json";

/** Public URL of the published JSON Schema for {@link E6ProjectFile}. */
export const E6_PROJECT_FILE_SCHEMA_URL = "https://e6code.com/schema/e6.json";

/** Schema URL from files published while the site was still on e6.codes. */
const LEGACY_E6_PROJECT_FILE_SCHEMA_URL = "https://e6.codes/schema/e6.json";

const E6_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const E6_PROJECT_FILE_MAX_SCRIPTS = 50;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const E6ProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the E6 Code scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in an E6 Code terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  async: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Only for runOnWorktreeCreate scripts. When true (the default), the agent starts while the script is still running. Set false to hold the agent until the script exits.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into E6 Code.",
});
export type E6ProjectFileScript = typeof E6ProjectFileScript.Type;

export const E6ProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file. New files use "${E6_PROJECT_FILE_SCHEMA_URL}". Files that still use "${LEGACY_E6_PROJECT_FILE_SCHEMA_URL}" are valid.`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before E6 Code\'s built-in icon locations.',
      },
      E6_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  defaultThreadEnvMode: Schema.optionalKey(
    ThreadEnvMode.annotate({
      description:
        'Where new threads start for this repository: "worktree" for a fresh git worktree, "local" for the current checkout. A per-project setting in E6 Code overrides this; when neither is set, the global default applies.',
    }),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(E6ProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in E6 Code.",
      })
      .check(Schema.isMaxLength(E6_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "E6 project file",
  description:
    "Checked-in project configuration for E6 Code (e6.json at the repository root). See https://e6code.com for documentation.",
});
export type E6ProjectFile = typeof E6ProjectFile.Type;

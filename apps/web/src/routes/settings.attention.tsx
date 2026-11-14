import { createFileRoute } from "@tanstack/react-router";

import { AttentionSettingsPanel } from "../components/settings/AttentionSettings";

function SettingsAttentionRoute() {
  return <AttentionSettingsPanel />;
}

export const Route = createFileRoute("/settings/attention")({
  component: SettingsAttentionRoute,
});

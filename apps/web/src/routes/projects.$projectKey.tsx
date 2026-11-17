import { createFileRoute, redirect } from "@tanstack/react-router";
import { canEnterApp } from "../localEnvironmentStatus";

export const Route = createFileRoute("/projects/$projectKey")({
  beforeLoad: async ({ context, params }) => {
    if (!canEnterApp(context.authGateState)) {
      throw redirect({ to: "/pair", replace: true });
    }
    throw redirect({
      to: "/settings/projects",
      search: { project: params.projectKey, machine: undefined },
      replace: true,
    });
  },
});

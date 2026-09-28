import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  git: {
    deploymentEnabled: false,
  },
  installCommand: "npm install -g vite-plus && vp install --filter '@e6tools/marketing...'",
  buildCommand: "vp run --filter @e6tools/marketing build",
  outputDirectory: "dist",
  // `curl … | sh` needs the scripts served as plain text, uncompressed by
  // content negotiation, and never cached past a deploy.
  headers: [
    {
      source: "/install.sh",
      headers: [
        { key: "Content-Type", value: "text/x-shellscript; charset=utf-8" },
        { key: "Cache-Control", value: "public, max-age=300" },
      ],
    },
    {
      source: "/install.ps1",
      headers: [
        { key: "Content-Type", value: "text/plain; charset=utf-8" },
        { key: "Cache-Control", value: "public, max-age=300" },
      ],
    },
  ],
  redirects: [
    {
      source: "/app",
      destination: "https://app.e6.codes",
      permanent: true,
    },
  ],
};

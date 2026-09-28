import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://e6.codes",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});

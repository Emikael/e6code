import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://e6code.com",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});

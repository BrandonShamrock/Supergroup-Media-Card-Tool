import { defineConfig } from "vite";
export default defineConfig({
  // Prebundle lazy workflow dependencies before navigation to avoid development reloads.
  optimizeDeps: {
    include: ["read-excel-file/browser", "papaparse", "libphonenumber-js/max"],
  },
});

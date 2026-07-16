import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "web/assets",
  build: { outDir: process.env.VITE_OUT_DIR ?? "dist" },
});

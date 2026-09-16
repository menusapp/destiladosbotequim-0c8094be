import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: mode === "development",
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: mode === "production",
        drop_debugger: mode === "production",
        pure_funcs: mode === "production" ? ["console.log", "console.debug"] : [],
      },
    },
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
            "@radix-ui/react-popover",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-accordion",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-label",
            "@radix-ui/react-radio-group",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
          ],
          "vendor-charts": ["recharts"],
          "vendor-forms": ["react-hook-form", "@hookform/resolvers", "zod"],
          "vendor-utils": ["date-fns", "clsx", "tailwind-merge"],
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

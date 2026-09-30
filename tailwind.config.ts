import type { Config } from "tailwindcss";

/**
 * Design tokens. Deliberately small: a neutral gray scale, one accent (used
 * for links and focus), and two status colors. The `ink` scale keeps its
 * historical name (950 = page, 50 = strongest text) so existing utilities
 * keep working while the look changes underneath them.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#ffffff",
          900: "#ffffff",
          800: "#f6f6f6",
          700: "#e4e4e4",
          600: "#cfcfcf",
          500: "#8c8c8c",
          400: "#666666",
          300: "#4d4d4d",
          200: "#333333",
          100: "#1f1f1f",
          50: "#0a0a0a",
        },
        // The single accent: links, focus rings, the current page.
        signal: {
          600: "#1d4ed8",
          500: "#2563eb",
          400: "#1d4ed8",
        },
        // Something needs a person.
        risk: {
          600: "#b42318",
          500: "#d92d20",
          400: "#d92d20",
        },
      },
      fontFamily: {
        // System fonts only: nothing to download, nothing to style.
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0f14",
          900: "#10161d",
          800: "#161e27",
          700: "#1f2a36",
          600: "#2b3947",
          500: "#3c4d5c",
          400: "#5c7285",
          300: "#8ea0af",
          200: "#c2ccd3",
          100: "#e6eaed",
          50: "#f5f7f8",
        },
        signal: {
          600: "#0e7c66",
          500: "#12a37f",
          400: "#2ec591",
        },
        risk: {
          600: "#b3401f",
          500: "#dd5a2c",
          400: "#f0803f",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "IBM Plex Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(11,15,20,0.06), 0 8px 24px rgba(11,15,20,0.08)",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(0.9)", opacity: "0.6" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.8s cubic-bezier(0.2,0.6,0.3,1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;

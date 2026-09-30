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
          950: "#f6f8f7",
          900: "#ffffff",
          800: "#edf1ef",
          700: "#dce4e0",
          600: "#c6d2cc",
          500: "#7c8d85",
          400: "#63786e",
          300: "#52675c",
          200: "#344a40",
          100: "#21372d",
          50: "#14271e",
        },
        signal: {
          600: "#166c58",
          500: "#20836b",
          400: "#176f5a",
        },
        risk: {
          600: "#b3401f",
          500: "#dd5a2c",
          400: "#f0803f",
        },
      },
      fontFamily: {
        sans: [
          "Segoe UI Variable",
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

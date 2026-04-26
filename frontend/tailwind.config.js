/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: "#f6efe5",
        ink: "#12202f",
        coral: "#ff6b57",
        spruce: "#0f766e",
        slate: "#526274",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        panel: "0 24px 80px rgba(18, 32, 47, 0.14)",
      },
    },
  },
  plugins: [],
};
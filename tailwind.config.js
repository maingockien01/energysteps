/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Event brand magenta. Used for headings, links and primary CTAs.
        brand: {
          DEFAULT: "#dd0071",
          dark: "#b3005c", // hover/active
        },
      },
      fontFamily: {
        // Be Vietnam Pro (imported in index.html) with Arial fallback.
        sans: ["'Be Vietnam Pro'", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

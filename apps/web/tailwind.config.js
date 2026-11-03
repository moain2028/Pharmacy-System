/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Tajawal", "IBM Plex Sans Arabic", "Segoe UI", "system-ui", "sans-serif"] },
      colors: { brand: { 50: "#eef7f4", 100: "#d5ebe3", 500: "#0f766e", 600: "#0b5f59", 700: "#084a46", 900: "#042f2c" } },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#6366f1",
        background: "#0a0a0a",
        surface: "#171717",
        border: "#262626",
        muted: "#a1a1aa",
      },
    },
  },
  plugins: [],
};

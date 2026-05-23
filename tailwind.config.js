/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ['Heebo', 'system-ui', 'sans-serif'] },
      colors: {
        bg:      'rgb(10 10 12)',
        surface: 'rgb(20 20 24)',
        border:  'rgb(38 38 44)',
        muted:   'rgb(120 120 130)',
        text:    'rgb(235 235 240)',
        accent:  'rgb(99 102 241)',
      },
    },
  },
  plugins: [],
};

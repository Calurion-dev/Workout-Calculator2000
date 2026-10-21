/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#22c55e', light: '#4ade80', dark: '#16a34a' },
        surface: '#1e293b',
        'surface-hover': '#334155',
        card: '#1a2332',
      },
    },
  },
};

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        garnet: {
          50: '#fff4f4',
          100: '#fbe2e2',
          200: '#f4c0c0',
          300: '#eb9191',
          400: '#d25c5c',
          500: '#8b1d2c',
          600: '#741624',
          700: '#5b101c'
        },
        gold: {
          50: '#fff8e6',
          100: '#ffedbf',
          200: '#f8d786',
          300: '#f2bf4a',
          400: '#e4a81f',
          500: '#c88a08',
          600: '#a96f05'
        },
        sand: '#fdf9f5',
        parchment: '#f7efe6',
        ink: '#2f2a28',
        ash: '#6b5b58'
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif']
      }
    }
  },
  plugins: []
};

export default config;

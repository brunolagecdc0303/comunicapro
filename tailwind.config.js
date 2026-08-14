/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#E8EBF0',
          100: '#C5CBD6',
          200: '#8B96AD',
          300: '#516184',
          400: '#1A2D4F',
          500: '#0A1B33', // brand primary
          600: '#08162A',
          700: '#061120',
          800: '#040B17',
          900: '#02060D',
        },
        accent: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316', // accent orange
          600: '#EA580C',
        }
      },
      fontFamily: {
        display: ['Montserrat', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}

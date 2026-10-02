/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: 'var(--navy-950)',
          900: 'var(--navy-900)',
          800: 'var(--navy-800)',
          700: 'var(--navy-700)',
          600: 'var(--navy-600)',
          500: 'var(--navy-500)',
        },
        cyan: {
          300: 'var(--cyan-400)',
          400: 'var(--cyan-400)',
          500: 'var(--cyan-500)',
          600: 'var(--cyan-600)',
        },
        slate: {
          100: 'var(--sl-100)',
          200: 'var(--sl-200)',
          300: 'var(--sl-300)',
          400: 'var(--sl-400)',
          500: 'var(--sl-500)',
          600: 'var(--sl-600)',
          700: 'var(--sl-700)',
          750: 'var(--sl-700)',
          800: 'var(--sl-800)',
          850: 'var(--sl-850)',
        },
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger:  'var(--color-danger)',
        info:    'var(--cyan-500)',
      },
      fontFamily: {
        display: ['"Outfit"', 'sans-serif'],
        body:    ['"Outfit"', 'sans-serif'],
        serif:   ['"Instrument Serif"', 'serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      boxShadow: {
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
        lg:  'var(--shadow-lg)',
        xl:  'var(--shadow-xl)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}

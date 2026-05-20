/** @type {import('tailwindcss').Config} */
// Build-time mirror of the previous CDN-loaded `tailwind.config = {...}` from
// index.html. Same theme tokens — only the load mechanism changed.
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: '#0b0f1a',
        surface: '#131826',
        surface2: '#1a2030',
        border: '#222b40',
        text: '#e7eaf2',
        muted: '#8a93a8',
        accent: '#6366f1',
        yes: '#22c55e',
        no: '#ef4444',
        saffron: '#ff9933',
        green: '#138808',
      },
      boxShadow: {
        card: '0 6px 24px rgba(0,0,0,0.35)',
        glow: '0 0 0 1px rgba(99,102,241,0.5), 0 8px 32px rgba(99,102,241,0.18)',
        lift: '0 12px 40px rgba(0,0,0,0.45)',
        inner: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      },
      animation: {
        'fade-in': 'fadeIn 240ms ease-out',
        'slide-up': 'slideUp 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pop': 'pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        pop: {
          '0%': { transform: 'scale(0.92)', opacity: 0 },
          '100%': { transform: 'scale(1)', opacity: 1 },
        },
        pulseSoft: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.6 },
        },
      },
    },
  },
  plugins: [],
}

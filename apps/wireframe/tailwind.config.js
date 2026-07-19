/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Tailwind default border color -> our hairline border everywhere
    borderColor: ({ theme }) => ({
      ...theme('colors'),
      DEFAULT: '#EBEBEB',
    }),
    extend: {
      colors: {
        ink: '#333333',
        ink2: '#1A1A1A',
        muted: '#666666',
        faint: '#999999',
        page: '#FCFCFC',
        panel: '#F8F8F8',
        hover: '#F4F4F4',
        sidebar: '#FBFBFB',
        line: '#EBEBEB',
        'line-mid': '#E3E3E3',
        'line-faint': '#D6D6D6',
        accent: {
          DEFAULT: '#3E63DD',
          hover: '#3A56C5',
          pressed: '#3651B8',
          soft: '#EDF0FD',
          soft2: '#DCE3FB',
        },
        success: { text: '#2A7E3B', bg: '#E7F5EA' },
        danger: { text: '#C62A2F', bg: '#FCEBEC' },
        warning: { text: '#9A6700', bg: '#FFF4D6' },
        info: { text: '#3E63DD', bg: '#EDF0FD' },
        purple: { text: '#7C3AED', bg: '#F2EBFE' },
        neut: { text: '#666666', bg: '#F1F1F1' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['11px', '1.4'],
        tiny: ['12px', '1.4'],
        sm: ['13px', '1.45'],
        base: ['14px', '1.5'],
        section: ['16px', '1.4'],
        title: ['20px', '1.3'],
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
      },
      boxShadow: {
        float: '0 8px 24px rgba(0,0,0,0.08)',
      },
      maxWidth: {
        shell: '1440px',
      },
    },
  },
  plugins: [],
}

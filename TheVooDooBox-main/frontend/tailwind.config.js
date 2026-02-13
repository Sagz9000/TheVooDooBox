/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Cyber Purple Theme
                // BoomBox Theme
                // BoomBox Theme
                brand: {
                    500: "#3b82f6", // Blue (from V4 Mockup)
                    600: "#2563eb",
                    700: "#1d4ed8",
                    400: "#60a5fa",
                    300: "#93c5fd",
                },
                voodoo: {
                    purple: '#bf00ff',
                    green: '#00ff41',
                    teal: '#00f0ff',
                    dark: '#050505',
                    panel: '#101015',
                    border: '#333333',
                    'toxic-green': '#ccff00',
                    'voltage-blue': '#00f0ff',
                    'void-black': '#050505',
                    'industrial-gray': '#1a1a1a',
                },
                boombox: {
                    purple: "#BF00FF",
                    green: "#00FF00",
                    teal: "#00E5FF",
                    dark: "#050505",
                    panel: "#0a0a0a",
                    border: "#1a1a1a",
                },
                security: {
                    bg: "#050505",      // Deeper Black
                    surface: "#0a0a0a", // Near Black
                    panel: "#121212",
                    border: "#BF00FF33", // Faint Neon Purple
                    muted: "#00E5FF88",   // Faint Neon Teal
                    active: "#BF00FF"
                },
                threat: {
                    critical: "#FF003C", // Cyber Red
                    high: "#FFAC00",     // Cyber Orange
                    medium: "#FFFC00",   // Cyber Yellow
                    low: "#00FF00",      // Electric Green
                    info: "#00E5FF"
                }
            },
            backgroundImage: {
                'chrome-gradient': 'linear-gradient(180deg, #FFFFFF 0%, #A0A0A0 50%, #606060 51%, #D0D0D0 100%)',
                'boombox-gradient': 'radial-gradient(circle at center, #BF00FF33 0%, transparent 70%)',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            animation: {
                'spin-slow': 'spin 3s linear infinite',
            },
        },
    },
    plugins: [],
}

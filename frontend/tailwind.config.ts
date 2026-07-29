import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // M3 semantic tokens — driven by CSS variables in globals.css
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--on-primary) / <alpha-value>)",
          container: "hsl(var(--primary-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-primary-container) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--on-secondary) / <alpha-value>)",
          container: "hsl(var(--secondary-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-secondary-container) / <alpha-value>)",
        },
        tertiary: {
          DEFAULT: "hsl(var(--tertiary) / <alpha-value>)",
          foreground: "hsl(var(--on-tertiary) / <alpha-value>)",
          container: "hsl(var(--tertiary-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-tertiary-container) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "hsl(var(--surface) / <alpha-value>)",
          "container-lowest": "hsl(var(--surface-container-lowest) / <alpha-value>)",
          "container-low": "hsl(var(--surface-container-low) / <alpha-value>)",
          container: "hsl(var(--surface-container) / <alpha-value>)",
          "container-high": "hsl(var(--surface-container-high) / <alpha-value>)",
          "container-highest": "hsl(var(--surface-container-highest) / <alpha-value>)",
        },
        "on-surface": {
          DEFAULT: "hsl(var(--on-surface) / <alpha-value>)",
          variant: "hsl(var(--on-surface-variant) / <alpha-value>)",
        },
        outline: {
          DEFAULT: "hsl(var(--outline) / <alpha-value>)",
          variant: "hsl(var(--outline-variant) / <alpha-value>)",
        },
        inverse: {
          surface: "hsl(var(--inverse-surface) / <alpha-value>)",
          "on-surface": "hsl(var(--inverse-on-surface) / <alpha-value>)",
          primary: "hsl(var(--inverse-primary) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          container: "hsl(var(--success-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-success-container) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          container: "hsl(var(--warning-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-warning-container) / <alpha-value>)",
        },
        error: {
          DEFAULT: "hsl(var(--error) / <alpha-value>)",
          container: "hsl(var(--error-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-error-container) / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          container: "hsl(var(--info-container) / <alpha-value>)",
          "container-foreground": "hsl(var(--on-info-container) / <alpha-value>)",
        },
        scrim: "hsl(var(--scrim) / <alpha-value>)",
      },
      borderRadius: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
      },
      spacing: {
        // 4px base unit already default in Tailwind; add M3-friendly extras
        "4.5": "1.125rem",
        "13": "3.25rem",
        "18": "4.5rem",
      },
      transitionTimingFunction: {
        m3: "cubic-bezier(0.2, 0, 0, 1)",
        "m3-emphasized": "cubic-bezier(0.2, 0, 0, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(16px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "scale-in": {
          from: { transform: "scale(0.96)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.2,0,0,1)",
        "slide-up": "slide-up 250ms cubic-bezier(0.2,0,0,1)",
        "scale-in": "scale-in 200ms cubic-bezier(0.2,0,0,1)",
        indeterminate: "indeterminate 1.5s infinite linear",
      },
    },
  },
  plugins: [],
};

export default config;

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { RoleProvider } from "@/components/shell/RoleSwitcher";

export const metadata: Metadata = {
  title: "SpendFlow — Spend Management",
  description:
    "SpendFlow — travel expense reimbursement and approval. Submit a complete claim with receipts in under two minutes.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fd" },
    { media: "(prefers-color-scheme: dark)", color: "#141419" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Prevent a flash of the wrong theme before hydration.
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('spendflow.theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <RoleProvider>
            <SnackbarProvider>{children}</SnackbarProvider>
          </RoleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Fraunces, Newsreader } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inversão",
  description:
    "Analisa um raciocínio, uma decisão ou um texto à luz da Trilogia Analítica de Norberto Keppe.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f0e4" },
    { media: "(prefers-color-scheme: dark)", color: "#17140f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-PT" className={`${fraunces.variable} ${newsreader.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-raised focus:px-4 focus:py-2"
        >
          Saltar para o conteúdo
        </a>
        <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10">
          <header className="flex items-baseline justify-between pb-6 md:pt-4">
            <p className="font-display text-2xl tracking-tight">Inversão</p>
            <Nav variant="top" />
          </header>
          <main id="conteudo" className="flex-1">
            {children}
          </main>
        </div>
        <Nav variant="bottom" />
      </body>
    </html>
  );
}

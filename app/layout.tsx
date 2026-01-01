import { Analytics } from "@vercel/analytics/next"
import Script from 'next/script'
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quartiles Solver',
  description: 'Solve Quartiles word puzzles by finding valid word combinations from tiles',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-P31MVCWGJV"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', 'G-P31MVCWGJV');
          `}
        </Script>
        {children}
        <Analytics />
      </body>
    </html>
  )
}


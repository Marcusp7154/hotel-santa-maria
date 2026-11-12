import './globals.css';

export const metadata = {
  title: 'Hotel Santa Maria — Recepção',
  description: 'Sistema de gestão do Hotel Santa Maria',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#4A0A14' };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

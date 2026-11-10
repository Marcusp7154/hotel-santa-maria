import './globals.css';

export const metadata = {
  title: 'Hotel Santa Maria — Recepção',
  description: 'Sistema de gestão do Hotel Santa Maria',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

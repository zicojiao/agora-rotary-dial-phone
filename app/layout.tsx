import type { Metadata, Viewport } from 'next';
import '@/src/style.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#11191d',
};

export const metadata: Metadata = {
  title: 'Agora Telephone Co. — Rotary AI Call',
  description:
    'Dial a 1930s rotary telephone and speak with a fictional AI simulation powered by Agora Conversational AI.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="is-booting">{children}</body>
    </html>
  );
}

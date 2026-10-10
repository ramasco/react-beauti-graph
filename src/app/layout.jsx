import '../index.css';
import '../App.css';

export const metadata = {
  title: 'cytoscape-sbgn-react',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}

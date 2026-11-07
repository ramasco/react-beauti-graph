import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import 'react-beauti-graph/style.css';
import DemoApp from './DemoApp';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('index.html has no #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>
);

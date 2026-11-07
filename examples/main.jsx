import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import 'react-beauti-graph/style.css';
import DemoApp from './DemoApp';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>
);

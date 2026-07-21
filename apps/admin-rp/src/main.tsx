import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

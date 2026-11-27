import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GenomeChat } from './components/GenomeChat.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GenomeChat />
  </StrictMode>,
);

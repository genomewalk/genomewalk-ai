import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbeddingsChat } from './components/EmbeddingsChat.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbeddingsChat />
  </StrictMode>,
);

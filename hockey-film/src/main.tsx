import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';
import { useEditor } from './store/editorStore';
import { usePlayer } from './store/playerStore';

// Dev-only handle for debugging / automated tests.
if (import.meta.env.DEV) Object.assign(window, { __fr: { useEditor, usePlayer } });

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import React from 'react';
import {createRoot} from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/prose.css';
import './styles/chat.css';
import './styles/trace.css';
import './styles/views.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

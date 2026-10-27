import React from 'react';
import {createRoot} from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/prose.css';
import './styles/chat.css';
import './styles/trace.css';
import './styles/views.css';
import './styles/visuals.css';
import App from './App';

// The app runs only as the window's own page. A visual that loads the app's
// address in a frame gets nothing that can reach NullBot.
if (window.self === window.top) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@/assets/styles/index.css';
import '@/components/arc/foundation.css';
import '@/assets/styles/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount element');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

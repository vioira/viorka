import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastStack, ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import App from './App';
import '@/assets/styles/index.css';
import '@/components/arc/foundation.css';
import '@/assets/styles/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount element');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ToastStackProvider>
      <App />
      <ToastStack label="消息提示" />
    </ToastStackProvider>
  </React.StrictMode>,
);

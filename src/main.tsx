import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/libre-baskerville/400-italic.css';
import './styles/index.css';
import { App } from './app/App';
import { recoverInterruptedRestore } from './storage/backup';
import { RestoreRecovery } from './storage/RestoreRecovery';

const recovery = recoverInterruptedRestore();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{recovery === 'failed'
  ? <RestoreRecovery />
  : <App />}</React.StrictMode>);

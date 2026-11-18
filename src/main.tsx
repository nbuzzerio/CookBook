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
import { initialize } from './sync/store';
import { startSync } from './sync/engine';
import { RestoreRecoveryRequired } from './storage/backup';
import { RestoreRecovery } from './storage/RestoreRecovery';

const root = ReactDOM.createRoot(document.getElementById('root')!);
initialize().then(() => {
  root.render(<React.StrictMode><App /></React.StrictMode>);
  startSync();
}).catch((error: unknown) => {
  root.render(error instanceof RestoreRecoveryRequired ? <RestoreRecovery /> :
    <main className="empty-state"><h1>Your saved cookbook could not open.</h1>
    <p>{error instanceof Error ? error.message : 'Allow browser storage and try again.'}</p>
    <button className="btn btn-primary" onClick={() => location.reload()}>Retry opening cookbook</button></main>);
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {
    // Local saves still work when the browser declines offline shell caching.
  });
}

import { useState } from 'react';
import { AlertCircle, Download, RotateCcw } from 'lucide-react';
import { resetStorage, STORAGE_PREFIX } from './persistence';

/** Keep failed recovery from editing partial data, with an escape route for damaged journals. */
export function RestoreRecovery() {
  const [error, setError] = useState('');

  function downloadRecovery() {
    setError('');
    try {
      const storage = window.localStorage;
      const entries = Object.keys(storage).filter(key => key.startsWith(STORAGE_PREFIX)).map(key => [key, storage.getItem(key)]);
      const text = JSON.stringify({ format: 'countertop-recovery', version: 1, entries }, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'countertop-recovery-data.json';
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Recovery data could not be read. Allow browser storage for this site, then retry.'); }
  }

  function startFresh() {
    if (!window.confirm('Start fresh? This removes all Countertop data in this browser, including the recovery copy. Save recovery data first if you need to keep it. You can then restore a previously downloaded full backup.')) return;
    if (resetStorage()) window.location.reload();
    else setError('Browser storage could not be cleared. Allow storage for this site, then retry.');
  }

  return <main className="empty-state" style={{ maxWidth: 680, margin: '40px auto' }}>
    <AlertCircle size={32} aria-hidden="true" />
    <h1>Your cookbook needs a moment.</h1>
    <p>We couldn’t finish recovering an interrupted restore. Retry after allowing browser storage. If recovery keeps failing, save the recovery data before starting fresh.</p>
    <button className="btn btn-primary" onClick={() => window.location.reload()}><RotateCcw size={17} aria-hidden="true" />Retry cookbook recovery</button>
    <button className="btn btn-secondary" onClick={downloadRecovery}><Download size={17} aria-hidden="true" />Save recovery data</button>
    <p className="muted">The recovery file keeps the raw saved data for manual repair. It is separate from a full cookbook backup.</p>
    <button className="text-button" onClick={startFresh}>Start fresh with sample recipes</button>
    {error && <p role="alert">{error}</p>}
  </main>;
}

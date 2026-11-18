import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, Archive, ArrowDownToLine, ArrowUpFromLine, Check, FileJson, RotateCcw, X } from 'lucide-react';
import { MAX_BACKUP_BYTES, parseBackup, type CookbookBackup } from '../../domain/backup';
import './full-backup.css';

type Props = {
  onExport: () => void;
  onRestore: (backup: CookbookBackup) => void;
  currentRecipeCount: number;
};

export function FullBackup({ onExport, onRestore, currentRecipeCount }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const previewTitle = useRef<HTMLHeadingElement>(null);
  const readVersion = useRef(0);
  const [backup, setBackup] = useState<CookbookBackup | null>(null);
  const [filename, setFilename] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { if (backup) previewTitle.current?.focus(); }, [backup]);

  function download() {
    setError(''); setNotice('');
    try {
      onExport();
      setNotice('Full backup download prepared. Keep the JSON file somewhere safe.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your full backup could not be created. Please try again.');
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++readVersion.current;
    setError(''); setNotice(''); setBackup(null); setConfirmed(false); setReading(true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error(`This backup is too large. Choose a JSON file no larger than ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB.`);
      const parsed = parseBackup(await file.text());
      if (readVersion.current !== version) return;
      setFilename(file.name); setBackup(parsed);
    } catch (cause) {
      if (readVersion.current !== version) return;
      setError(cause instanceof Error ? cause.message : 'This backup could not be read. Choose a full Countertop backup JSON file.');
    } finally {
      if (readVersion.current === version) setReading(false);
    }
  }

  function cancel() {
    ++readVersion.current;
    setBackup(null); setConfirmed(false); setError(''); setNotice(''); setReading(false);
    chooseButton.current?.focus();
  }

  function restore() {
    if (!backup || !confirmed || restoring) return;
    setError(''); setNotice(''); setRestoring(true);
    try {
      onRestore(backup);
      setBackup(null); setConfirmed(false);
      setNotice('Your full cookbook backup has been restored.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The backup could not be restored. Please try again.');
    } finally { setRestoring(false); }
  }

  return <section className="data-section card full-backup" id="full-cookbook-backup" aria-labelledby={`${id}-title`}>
    <div className="data-section-title">
      <span className="data-section-icon"><Archive size={20} aria-hidden="true" /></span>
      <div><h2 id={`${id}-title`}>Full cookbook backup</h2><p>Your recipes and all the little things that make them yours.</p></div>
    </div>
    <p className="full-backup-description">Save recipes, personal shopping notes, favorites, serving choices, shopping lists, ingredient checks, cooking progress, dinner timing, and appearance together in one file.</p>
    <div className="full-backup-actions">
      <button type="button" className="btn btn-primary" onClick={download} disabled={restoring}><ArrowDownToLine size={17} aria-hidden="true" />Download full backup</button>
      <button type="button" className="btn btn-secondary" ref={chooseButton} onClick={() => input.current?.click()} disabled={reading || restoring}><ArrowUpFromLine size={17} aria-hidden="true" />{reading ? 'Reading backup…' : 'Choose backup file'}</button>
    </div>
    <input ref={input} type="file" accept=".json,application/json" className="data-file-input" aria-label="Restore full cookbook backup file" onChange={event => void readFile(event)} tabIndex={-1} />
    <p className="full-backup-footnote">Image files are not embedded. Recipe-only JSON exports remain available above for sharing recipes.</p>

    {error && <div className="data-feedback data-error" role="alert"><AlertCircle size={19} aria-hidden="true" /><div><strong>We couldn’t finish that.</strong><pre>{error}</pre></div><button type="button" className="btn btn-icon" aria-label="Dismiss backup error" onClick={() => setError('')}><X size={17} aria-hidden="true" /></button></div>}
    {notice && <div className="data-feedback data-success" role="status"><Check size={19} aria-hidden="true" /><p>{notice}</p><button type="button" className="btn btn-icon" aria-label="Dismiss backup message" onClick={() => setNotice('')}><X size={17} aria-hidden="true" /></button></div>}

    {backup && <section className="full-backup-preview" aria-label="Review full cookbook restore">
      <p className="eyebrow">A SAVED MOMENT IN YOUR KITCHEN</p>
      <h3 ref={previewTitle} tabIndex={-1}>Bring your cookbook back.</h3>
      <p className="full-backup-filename"><FileJson size={16} aria-hidden="true" /><span>{filename}</span></p>
      <p className="full-backup-date">Backed up <time dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></p>
      <dl className="full-backup-summary">
        <div><dt>Recipes</dt><dd>{backup.state.recipes.length}</dd></div>
        <div><dt>Favorites</dt><dd>{backup.state.favorites.length}</dd></div>
        <div><dt>Shopping notes</dt><dd>{Object.keys(backup.state.shoppingNotes).length}</dd></div>
        <div><dt>Cooking sessions</dt><dd>{Object.keys(backup.state.sessions).length}</dd></div>
      </dl>
      <div className="full-backup-replace" id={`${id}-replace`}><AlertCircle size={19} aria-hidden="true" /><p><strong>This replaces your current cookbook.</strong> Your {currentRecipeCount} current {currentRecipeCount === 1 ? 'recipe' : 'recipes'} and all Countertop lists, notes, preferences, and progress will be replaced by this backup. They will not be merged. Download a full backup first if you want to keep your current data. Close other Countertop tabs before restoring.</p></div>
      <p className="full-backup-timers">Running cooking sessions and timers return paused at the backup’s saved time. Timers already elapsed then show as finished. Resume when you’re ready to cook.</p>
      <label className="full-backup-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={restoring} aria-describedby={`${id}-replace`} /><span>Replace my current cookbook and progress</span></label>
      <div className="full-backup-actions"><button type="button" className="btn btn-primary" disabled={!confirmed || restoring} onClick={restore}><RotateCcw size={16} aria-hidden="true" />{restoring ? 'Restoring…' : 'Restore this backup'}</button><button type="button" className="btn btn-secondary" onClick={cancel} disabled={restoring}>Cancel</button></div>
    </section>}
  </section>;
}

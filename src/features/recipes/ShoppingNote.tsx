import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, NotebookPen, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { SHOPPING_NOTE_LIMIT } from '../../domain/shoppingNotes';
import './shopping-note.css';

interface ShoppingNoteProps {
  value: string;
  onSave: (note: string, expected: string) => Promise<void>;
  shared: boolean;
  sharedReminder?: string;
}

export function ShoppingNote({ value, onSave, shared, sharedReminder }: ShoppingNoteProps) {
  const id = useId();
  const [original, setOriginal] = useState(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [message, setMessage] = useState('');
  const [removedNote, setRemovedNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (returnFocus.current) {
      editButtonRef.current?.focus();
      returnFocus.current = false;
    }
  }, [editing]);

  function beginEditing() {
    setOriginal(value);
    setDraft(value);
    setMessage('');
    setRemovedNote(null);
    setEditing(true);
  }

  function finishEditing() {
    returnFocus.current = true;
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    setRemovedNote(!next && value ? value : null);
    try { await onSave(next, original); } catch (e) { setMessage(String(e)); return; }
    setMessage(next ? 'Shopping note saved.' : 'Shopping note removed.');
    finishEditing();
  }

  async function remove() {
    setRemovedNote(value);
    try { await onSave('', value); } catch (e) { setMessage(String(e)); return; }
    setMessage('Shopping note removed.');
    editButtonRef.current?.focus();
  }

  async function undoRemove() {
    if (removedNote === null) return;
    try { await onSave(removedNote, value); } catch (e) { setMessage(String(e)); return; }
    setRemovedNote(null);
    setMessage('Shopping note restored.');
    editButtonRef.current?.focus();
  }

  return <section className="shopping-note" aria-labelledby={`${id}-heading`}>
    <div className="shopping-note-heading">
      <h3 id={`${id}-heading`}><NotebookPen size={17} aria-hidden="true"/> Shopping note</h3>
      {!editing && <button type="button" className="text-button" onClick={beginEditing} ref={editButtonRef}>
        {value ? <Pencil size={14} aria-hidden="true"/> : <Plus size={15} aria-hidden="true"/>}
        {value ? 'Edit' : 'Add note'}
      </button>}
    </div>
    <p className="shopping-note-description" id={`${id}-description`}>Appears beside this recipe on your shopping list.</p>
    {editing ? <form onSubmit={save} className="shopping-note-form">
      <label htmlFor={`${id}-input`}>Your reminder</label>
      <textarea
        id={`${id}-input`}
        ref={inputRef}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        maxLength={SHOPPING_NOTE_LIMIT}
        rows={4}
        placeholder="Look for vegetarian Parmesan-style cheese."
        aria-describedby={`${id}-description ${id}-limit ${id}-storage`}
      />
      <p id={`${id}-limit`} className="shopping-note-limit">{SHOPPING_NOTE_LIMIT - draft.length} characters remaining</p>
      <div className="shopping-note-actions">
        <button type="submit" className="btn btn-primary"><Check size={15} aria-hidden="true"/> Save note</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setDraft(value); finishEditing(); }}>Cancel</button>
      </div>
    </form> : value && <div className="shopping-note-content">
      <p className="shopping-note-text">{value}</p>
      <button type="button" className="text-button shopping-note-remove" onClick={remove}><Trash2 size={14} aria-hidden="true"/> Remove note</button>
    </div>}
    <p className="shopping-note-storage" id={`${id}-storage`}>{shared ? 'Edits are shared with your household.' : 'Edits stay in this browser.'} Included in full cookbook backups.</p>
    {!shared && sharedReminder && <p>Household reminder · {sharedReminder}</p>}
    <div className="shopping-note-feedback">
      <p role="status">{message}</p>
      {removedNote !== null && !value && !editing && <button type="button" className="text-button" onClick={undoRemove}><Undo2 size={14} aria-hidden="true"/> Undo</button>}
    </div>
  </section>;
}

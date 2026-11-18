import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, NotebookPen, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { SHOPPING_NOTE_LIMIT } from '../../domain/shoppingNotes';
import './shopping-note.css';

interface ShoppingNoteProps {
  value: string;
  onSave: (note: string) => void;
}

export function ShoppingNote({ value, onSave }: ShoppingNoteProps) {
  const id = useId();
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
    setDraft(value);
    setMessage('');
    setRemovedNote(null);
    setEditing(true);
  }

  function finishEditing() {
    returnFocus.current = true;
    setEditing(false);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    setRemovedNote(!next && value ? value : null);
    onSave(next);
    setMessage(next ? 'Shopping note saved.' : 'Shopping note removed.');
    finishEditing();
  }

  function remove() {
    setRemovedNote(value);
    onSave('');
    setMessage('Shopping note removed.');
    editButtonRef.current?.focus();
  }

  function undoRemove() {
    if (removedNote === null) return;
    onSave(removedNote);
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
    <p className="shopping-note-storage" id={`${id}-storage`}>Saved in this browser. Included in full cookbook backups.</p>
    <div className="shopping-note-feedback">
      <p role="status">{message}</p>
      {removedNote !== null && !value && !editing && <button type="button" className="text-button" onClick={undoRemove}><Undo2 size={14} aria-hidden="true"/> Undo</button>}
    </div>
  </section>;
}

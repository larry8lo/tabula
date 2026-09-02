# Tabula

A simple task/reminder web app: toolbar + sortable task table, backed by SQLite.

## Setup

Requires Python 3.8+.

```bash
cd tabula
pip install -r requirements.txt
python3 app.py
```

Then open **http://127.0.0.1:5050** in your browser.

The database file is created automatically at `~/.tabula/tabula.db` the
first time the app starts.

## Features

- **+ New Task ▾** — pick a relative due time (15 min, 1 hour, 4 hours, end of
  today, end of tomorrow, end of week) and just type a name, or choose
  **Custom…** for a form with an exact due date/time and notes.
- **Task table** — sorted ascending by due date. Overdue in-progress tasks are
  highlighted in red. Each column edits inline, no modal:
  - **Task name** — click to rename in place (Enter to save, Escape to
    cancel).
  - **Due date** — click to pop up the date/time picker; changes save as
    soon as you pick a day or time.
  - **Status** — click the badge to pop up In Progress / Complete / Canceled.
- **Notes** — a 📝 icon appears next to a task's name when it has notes;
  click it to pop up the notes (any URL inside is rendered as a clickable
  link). The ✎ per-row button opens a small modal to add or edit notes.
- **Click anywhere else on a row** to select/deselect it. With one or more
  rows selected, the toolbar's Complete / Cancel / Delete buttons become
  active and apply to all selected tasks.
- **Per-row buttons** (✎ edit notes, ✓ complete, ⦸ cancel, 🗑 delete) act on
  just that task.
- **Desktop notifications** — while the app is running, an in-progress task
  triggers a macOS notification the moment it becomes due (checked every 30s).
  Each task notifies once; editing its due date re-arms it. macOS-only —
  the first notification may require granting notification permission to
  the terminal/Python process in System Settings → Notifications.

## Notes

- Run with `python3 app.py` for local development (Flask's built-in server,
  debug mode on). For anything beyond personal local use, run it behind a
  real WSGI server (gunicorn, etc.) instead.
- To reset all data, stop the app and delete `~/.tabula/tabula.db`.

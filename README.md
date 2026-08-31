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

The database file is created automatically at `~/tabula.db` (your home
directory) the first time the app starts.

## Features

- **+ New Task** — opens a form for a task name and an exact due date/time.
- **Quick Add ▾** — pick a relative due time (15 min, 1 hour, 4 hours, end of
  today, 3 days, end of week), then just type a name.
- **Task table** — sorted ascending by due date. Overdue in-progress tasks are
  highlighted in red.
- **Click a task's name** to change its due date.
- **Click anywhere else on a row** to select/deselect it. With one or more
  rows selected, the toolbar's Complete / Cancel / Delete buttons become
  active and apply to all selected tasks.
- **Per-row buttons** (✓ complete, ⦸ cancel, 🗑 delete) act on just that task.

## Notes

- Run with `python3 app.py` for local development (Flask's built-in server,
  debug mode on). For anything beyond personal local use, run it behind a
  real WSGI server (gunicorn, etc.) instead.
- To reset all data, stop the app and delete `~/tabula.db`.

import os
import sqlite3
from datetime import datetime, timedelta

from flask import Flask, g, jsonify, render_template, request

# DB lives in the user's home directory, e.g. ~/tabula.db
DB_PATH = os.path.expanduser("~/tabula.db")
VALID_STATUSES = ("in_progress", "complete", "canceled")

app = Flask(__name__)


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            due_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'in_progress',
            created_at TEXT NOT NULL
        )
        """
    )
    db.commit()
    db.close()


def compute_preset_due(preset, now=None):
    now = now or datetime.now()
    if preset == "15m":
        return now + timedelta(minutes=15)
    if preset == "1h":
        return now + timedelta(hours=1)
    if preset == "4h":
        return now + timedelta(hours=4)
    if preset == "eod":
        return now.replace(hour=23, minute=59, second=0, microsecond=0)
    if preset == "3d":
        return now + timedelta(days=3)
    if preset == "eow":
        # Week ends Sunday night. If today is Sunday, this is "today" end of day.
        days_ahead = 6 - now.weekday()  # Monday=0 ... Sunday=6
        target = now + timedelta(days=days_ahead)
        return target.replace(hour=23, minute=59, second=0, microsecond=0)
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    db = get_db()
    rows = db.execute("SELECT * FROM tasks ORDER BY due_time ASC, id ASC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    due_time = (data.get("due_time") or "").strip()
    if not name or not due_time:
        return jsonify({"error": "name and due_time are required"}), 400
    db = get_db()
    cur = db.execute(
        "INSERT INTO tasks (name, due_time, status, created_at) VALUES (?, ?, 'in_progress', ?)",
        (name, due_time, datetime.now().isoformat(timespec="seconds")),
    )
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/tasks/quick", methods=["POST"])
def quick_create_task():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    preset = data.get("preset")
    if not name or not preset:
        return jsonify({"error": "name and preset are required"}), 400
    due = compute_preset_due(preset)
    if due is None:
        return jsonify({"error": "unknown preset"}), 400
    db = get_db()
    cur = db.execute(
        "INSERT INTO tasks (name, due_time, status, created_at) VALUES (?, ?, 'in_progress', ?)",
        (name, due.isoformat(timespec="minutes"), datetime.now().isoformat(timespec="seconds")),
    )
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
def update_task(task_id):
    data = request.get_json(silent=True) or {}
    fields, values = [], []

    if "due_time" in data:
        fields.append("due_time = ?")
        values.append(data["due_time"])
    if "status" in data:
        if data["status"] not in VALID_STATUSES:
            return jsonify({"error": "invalid status"}), 400
        fields.append("status = ?")
        values.append(data["status"])
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            return jsonify({"error": "name cannot be empty"}), 400
        fields.append("name = ?")
        values.append(name)

    if not fields:
        return jsonify({"error": "no fields to update"}), 400

    db = get_db()
    values.append(task_id)
    db.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    db = get_db()
    db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    return "", 204


@app.route("/api/tasks/bulk", methods=["POST"])
def bulk_update():
    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    action = data.get("action")
    if not ids or action not in ("delete", "complete", "cancel"):
        return jsonify({"error": "invalid request"}), 400

    ids = [int(i) for i in ids]
    db = get_db()
    placeholders = ",".join("?" for _ in ids)
    if action == "delete":
        db.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", ids)
    elif action == "complete":
        db.execute(f"UPDATE tasks SET status = 'complete' WHERE id IN ({placeholders})", ids)
    elif action == "cancel":
        db.execute(f"UPDATE tasks SET status = 'canceled' WHERE id IN ({placeholders})", ids)
    db.commit()
    return "", 204


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5050)

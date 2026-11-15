#!/usr/bin/env python3
"""MCP server for Tabula: lets Claude manage tasks and check reminders.

Talks to the running Tabula web app over its REST API (default
http://127.0.0.1:5050), so validation, recurring-task generation and desktop
notifications all stay in the app. Speaks MCP over stdio, so stdout belongs to
the protocol -- anything diagnostic must go to stderr.

Environment:
  TABULA_URL        base URL of the app (default http://127.0.0.1:5050)
  TABULA_AUTOSTART  set to 0 to stop the server launching ./start.sh when the
                    app isn't running (only ever applies to the default URL)
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

BASE_URL = os.environ.get("TABULA_URL", "http://127.0.0.1:5050").rstrip("/")
AUTOSTART = os.environ.get("TABULA_AUTOSTART", "1") != "0"
APP_DIR = os.path.dirname(os.path.abspath(__file__))
REQUEST_TIMEOUT = 10
TIME_FMT = "%Y-%m-%dT%H:%M"

# Never route requests to the local app through an HTTP(S)_PROXY from the env.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class TabulaError(ToolError):
    """An anticipated failure. Subclassing ToolError makes the SDK hand the message
    to the model (is_error=True) instead of replacing it with a generic crash notice."""


# ---------------------------------------------------------------- HTTP layer


def _error_message(err):
    try:
        payload = json.loads(err.read().decode("utf-8"))
        if isinstance(payload, dict) and payload.get("error"):
            return str(payload["error"])
    except Exception:
        pass
    return f"Tabula returned HTTP {err.code}"


def _raw_request(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    with _opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


def _is_connection_refused(err):
    reason = getattr(err, "reason", err)
    return isinstance(reason, ConnectionRefusedError)


def _can_autostart():
    parsed = urllib.parse.urlparse(BASE_URL)
    return AUTOSTART and parsed.hostname in ("127.0.0.1", "localhost") and (parsed.port or 80) == 5050


def _start_app():
    """Run ./start.sh and wait for the app to answer. Returns True if it's up."""
    print("Tabula isn't running; launching it with start.sh", file=sys.stderr)
    try:
        subprocess.run([os.path.join(APP_DIR, "start.sh")], capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"start.sh failed: {e}", file=sys.stderr)
        return False
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            _raw_request("GET", "/api/tasks")
            return True
        except urllib.error.HTTPError:
            return True  # it answered, even if with an error
        except (urllib.error.URLError, OSError):
            time.sleep(0.5)
    return False


def _request(method, path, body=None):
    try:
        return _raw_request(method, path, body)
    except urllib.error.HTTPError as e:
        raise TabulaError(_error_message(e)) from None
    except (urllib.error.URLError, OSError) as first:
        if _is_connection_refused(first) and _can_autostart() and _start_app():
            try:
                return _raw_request(method, path, body)
            except urllib.error.HTTPError as e:
                raise TabulaError(_error_message(e)) from None
            except (urllib.error.URLError, OSError):
                pass
        raise TabulaError(
            f"Can't reach Tabula at {BASE_URL}. Start it with ./start.sh in {APP_DIR} "
            f"(or set TABULA_URL if it runs elsewhere)."
        ) from None


# ------------------------------------------------------------- time helpers


def _parse_stored(value):
    """Parse a stored due_time. The web UI saves UTC ("...Z"); quick-add and
    recurring tasks save naive local time. Normalise both to naive local."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def _parse_user_due(value):
    """Turn a user/Claude-supplied due time into the app's naive-local format."""
    text = value.strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise TabulaError(
            f"Couldn't parse {value!r} as a date/time. Use ISO 8601 local time, e.g. "
            "2026-11-03T14:30, or just 2026-11-03 for the end of that day."
        ) from None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    elif len(text) == 10:  # date only -> end of day, like the app's "End of today"
        dt = dt.replace(hour=23, minute=59)
    return dt.strftime(TIME_FMT)


def _humanize(delta):
    seconds = int(delta.total_seconds())
    overdue = seconds < 0
    seconds = abs(seconds)
    if seconds < 60:
        return "due now"
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        text = f"{days}d {hours}h" if hours else f"{days}d"
    elif hours:
        text = f"{hours}h {minutes}m" if minutes else f"{hours}h"
    else:
        text = f"{minutes}m"
    return f"{text} overdue" if overdue else f"in {text}"


def _fmt_clock(hhmm):
    hour, minute = map(int, hhmm.split(":"))
    return f"{hour % 12 or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


def _norm_clock(value):
    """Accept '9:00', '09:00', '21:30', '9am', '9:30 PM' -> 'HH:MM'."""
    text = str(value).strip().upper().replace(" ", "")
    for fmt in ("%H:%M", "%I:%M%p", "%I%p"):
        try:
            return datetime.strptime(text, fmt).strftime("%H:%M")
        except ValueError:
            continue
    raise TabulaError(f"Couldn't parse time {value!r}. Use e.g. '09:00', '21:30' or '9:30 PM'.")


# ------------------------------------------------------------ view builders


def _task_view(task, now):
    due = _parse_stored(task["due_time"])
    in_progress = task["status"] == "in_progress"
    view = {
        "id": task["id"],
        "name": task["name"],
        "status": task["status"],
        "due": due.strftime(TIME_FMT),
    }
    if in_progress:
        view["due_in"] = _humanize(due - now)
        view["overdue"] = due < now
    if task.get("notes"):
        view["notes"] = task["notes"]
    if task.get("recurring_task_id"):
        view["recurring_task_id"] = task["recurring_task_id"]
    return view


WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WEEKDAY_LOOKUP = {}
for _i, _label in enumerate(WEEKDAY_LABELS):
    WEEKDAY_LOOKUP[_label.lower()] = _i
for _i, _full in enumerate(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]):
    WEEKDAY_LOOKUP[_full] = _i


def _ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _summarize_schedule(schedule_type, schedule):
    if schedule_type == "daily":
        return "Every day at " + ", ".join(_fmt_clock(t) for t in schedule["times"])
    at = _fmt_clock(schedule["time"])
    if schedule_type == "weekly":
        return "Weekly on " + ", ".join(WEEKDAY_LABELS[d] for d in schedule["days"]) + f" at {at}"
    return "Monthly on the " + ", ".join(_ordinal(d) for d in schedule["days"]) + f" at {at}"


def _rule_view(rule):
    return {
        "id": rule["id"],
        "name": rule["name"],
        "notes": rule.get("notes"),
        "schedule_type": rule["schedule_type"],
        "schedule": rule["schedule"],
        "summary": _summarize_schedule(rule["schedule_type"], rule["schedule"]),
    }


def _next_occurrence(recurring_id):
    """Earliest not-yet-due task generated from this rule, as a view (or None)."""
    now = datetime.now()
    candidates = [
        _task_view(t, now)
        for t in _request("GET", "/api/tasks")
        if t.get("recurring_task_id") == recurring_id and t["status"] == "in_progress"
    ]
    upcoming = sorted((v for v in candidates if not v["overdue"]), key=lambda v: v["due"])
    return upcoming[0] if upcoming else None


# ------------------------------------------------------ schedule validation


def _norm_weekdays(days):
    out = set()
    for d in days:
        if isinstance(d, str) and d.strip().lower() in WEEKDAY_LOOKUP:
            out.add(WEEKDAY_LOOKUP[d.strip().lower()])
        elif isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6:
            out.add(d)
        else:
            raise TabulaError(f"Invalid weekday {d!r}. Use names like 'mon'/'Friday' or integers 0 (Mon) to 6 (Sun).")
    return sorted(out)


def _norm_monthdays(days):
    out = set()
    for d in days:
        if isinstance(d, str) and d.strip().isdigit():
            d = int(d.strip())
        if isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 31:
            out.add(d)
        else:
            raise TabulaError(f"Invalid day of month {d!r}. Use integers 1-31.")
    return sorted(out)


def _reject_irrelevant(schedule_type, times, days, time_):
    if schedule_type == "daily" and (days is not None or time_ is not None):
        raise TabulaError("`days` and `time` don't apply to daily schedules; use `times` (a list of clock times).")
    if schedule_type in ("weekly", "monthly") and times is not None:
        raise TabulaError(f"`times` doesn't apply to {schedule_type} schedules; use `days` plus a single `time`.")


def _build_schedule(schedule_type, times, days, time_):
    if schedule_type == "daily":
        if not times:
            raise TabulaError("Daily schedules need `times`, e.g. ['09:00', '21:00'].")
        return {"times": sorted({_norm_clock(t) for t in times})}
    if not days:
        what = "weekdays, e.g. ['mon', 'wed', 'fri']" if schedule_type == "weekly" else "days of the month, e.g. [1, 15]"
        raise TabulaError(f"{schedule_type.capitalize()} schedules need `days` ({what}) and a `time`.")
    if time_ is None:
        raise TabulaError(f"{schedule_type.capitalize()} schedules need a `time`, e.g. '09:00'.")
    normalized = _norm_weekdays(days) if schedule_type == "weekly" else _norm_monthdays(days)
    return {"days": normalized, "time": _norm_clock(time_)}


# ------------------------------------------------------------------- server

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)
WRITE_IDEMPOTENT = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False)

mcp = MCPServer(
    "tabula",
    instructions=(
        "Tabula is the user's personal task and reminder app. Use get_reminders to see what is overdue or due "
        "soon, list_tasks to browse tasks, and the create/update/complete/cancel/delete tools to manage them. "
        "Recurring tasks are rules that Tabula expands into regular tasks (each shows a recurring_task_id); "
        "manage the rule itself with the *_recurring_task tools. All times are the user's local time in ISO 8601 "
        "(e.g. 2026-11-03T14:30). Call get_current_time before working out relative dates like 'tomorrow at 3pm'."
    ),
)

TaskIds = Annotated[list[int], Field(description="IDs of the tasks (as returned by list_tasks).", min_length=1)]


@mcp.tool(annotations=READ_ONLY)
def get_current_time() -> dict[str, Any]:
    """Current local date, time, weekday and timezone on the machine running Tabula.

    Use this before computing relative due dates ("tomorrow", "next Friday").
    """
    now = datetime.now().astimezone()
    return {
        "now": now.strftime(TIME_FMT),
        "weekday": now.strftime("%A"),
        "timezone": now.tzname(),
        "utc_offset": now.strftime("%z"),
    }


@mcp.tool(annotations=READ_ONLY)
def get_reminders(
    within_hours: Annotated[float, Field(description="How far ahead to look for upcoming tasks.", gt=0)] = 24,
) -> dict[str, Any]:
    """What needs attention right now: overdue tasks plus tasks coming due soon.

    Only in-progress tasks are considered. Each list is sorted by due time.
    """
    now = datetime.now()
    horizon = now + timedelta(hours=within_hours)
    overdue, due_soon = [], []
    for task in _request("GET", "/api/tasks"):
        if task["status"] != "in_progress":
            continue
        due = _parse_stored(task["due_time"])
        if due < now:
            overdue.append(_task_view(task, now))
        elif due <= horizon:
            due_soon.append(_task_view(task, now))
    overdue.sort(key=lambda v: v["due"])
    due_soon.sort(key=lambda v: v["due"])
    return {
        "now": now.strftime(TIME_FMT),
        "summary": f"{len(overdue)} overdue, {len(due_soon)} due in the next {within_hours:g}h",
        "overdue": overdue,
        "due_soon": due_soon,
    }


@mcp.tool(annotations=READ_ONLY)
def list_tasks(
    status: Annotated[
        Literal["in_progress", "complete", "canceled", "all"],
        Field(description="Which tasks to include."),
    ] = "in_progress",
) -> dict[str, Any]:
    """List tasks sorted by due time (earliest first)."""
    now = datetime.now()
    views = [
        _task_view(t, now)
        for t in _request("GET", "/api/tasks")
        if status == "all" or t["status"] == status
    ]
    views.sort(key=lambda v: v["due"])
    return {"now": now.strftime(TIME_FMT), "count": len(views), "tasks": views}


@mcp.tool(annotations=WRITE)
def create_task(
    name: Annotated[str, Field(description="Task title.", min_length=1)],
    due: Annotated[
        str | None,
        Field(description="Due time, ISO 8601 local time (2026-11-03T14:30). A bare date (2026-11-03) means 23:59 that day."),
    ] = None,
    preset: Annotated[
        Literal["15m", "1h", "4h", "eod", "eot", "eow"] | None,
        Field(description="Relative alternative to `due`: in 15 minutes / 1 hour / 4 hours, end of today / tomorrow / the week."),
    ] = None,
    notes: Annotated[str | None, Field(description="Optional free-form notes (URLs become clickable in the app).")] = None,
) -> dict[str, Any]:
    """Create a one-time task. Provide exactly one of `due` or `preset`."""
    if (due is None) == (preset is None):
        raise TabulaError("Provide exactly one of `due` or `preset`.")
    if preset is not None:
        created = _request("POST", "/api/tasks/quick", {"name": name, "preset": preset, "notes": notes})
    else:
        created = _request("POST", "/api/tasks", {"name": name, "due_time": _parse_user_due(due), "notes": notes})
    return _task_view(created, datetime.now())


@mcp.tool(annotations=WRITE_IDEMPOTENT)
def update_task(
    task_id: Annotated[int, Field(description="ID of the task to change.")],
    name: Annotated[str | None, Field(description="New title.")] = None,
    due: Annotated[str | None, Field(description="New due time (ISO 8601 local; bare date = 23:59 that day).")] = None,
    notes: Annotated[str | None, Field(description="New notes. Pass an empty string to clear them.")] = None,
    status: Annotated[
        Literal["in_progress", "complete", "canceled"] | None,
        Field(description="New status (use in_progress to reopen a finished task)."),
    ] = None,
) -> dict[str, Any]:
    """Change any of a task's name, due time, notes or status. Omitted fields are left alone.

    Changing the due time re-arms its desktop notification. For a task generated by a recurring
    rule this only edits that one occurrence -- use update_recurring_task to change the rule.
    """
    body = {}
    if name is not None:
        body["name"] = name
    if due is not None:
        body["due_time"] = _parse_user_due(due)
    if notes is not None:
        body["notes"] = notes
    if status is not None:
        body["status"] = status
    if not body:
        raise TabulaError("Nothing to update: pass at least one of name, due, notes or status.")
    updated = _request("PATCH", f"/api/tasks/{task_id}", body)
    return _task_view(updated, datetime.now())


def _bulk(action, task_ids, label):
    existing = {t["id"] for t in _request("GET", "/api/tasks")}
    found = [i for i in dict.fromkeys(task_ids) if i in existing]
    missing = [i for i in dict.fromkeys(task_ids) if i not in existing]
    if not found:
        raise TabulaError(f"No tasks found with id(s) {missing}.")
    _request("POST", "/api/tasks/bulk", {"ids": found, "action": action})
    result = {label: found}
    if missing:
        result["not_found"] = missing
    return result


@mcp.tool(annotations=WRITE_IDEMPOTENT)
def complete_tasks(task_ids: TaskIds) -> dict[str, Any]:
    """Mark one or more tasks as complete."""
    return _bulk("complete", task_ids, "completed")


@mcp.tool(annotations=WRITE_IDEMPOTENT)
def cancel_tasks(task_ids: TaskIds) -> dict[str, Any]:
    """Mark one or more tasks as canceled (kept in the list, but no longer active)."""
    return _bulk("cancel", task_ids, "canceled")


@mcp.tool(annotations=DESTRUCTIVE)
def delete_tasks(task_ids: TaskIds) -> dict[str, Any]:
    """Permanently delete one or more tasks.

    Deleting a task that came from a recurring rule only removes that occurrence -- Tabula will
    re-create the next upcoming one. To stop the repetition, use delete_recurring_task.
    """
    return _bulk("delete", task_ids, "deleted")


@mcp.tool(annotations=READ_ONLY)
def list_recurring_tasks() -> dict[str, Any]:
    """List recurring-task rules (not the individual tasks generated from them)."""
    rules = [_rule_view(r) for r in _request("GET", "/api/recurring")]
    return {"count": len(rules), "recurring_tasks": rules}


_ScheduleType = Annotated[
    Literal["daily", "weekly", "monthly"],
    Field(description="daily = one or more times every day; weekly = chosen weekdays; monthly = chosen days of the month."),
]
_Times = Annotated[
    list[str] | None,
    Field(description="Daily only: clock times, e.g. ['09:00', '21:30'] or ['9am', '9:30pm']."),
]
_Days = Annotated[
    list[int | str] | None,
    Field(description="Weekly: weekdays as names ('mon', 'Friday') or ints 0=Mon..6=Sun. Monthly: ints 1-31."),
]
_Time = Annotated[str | None, Field(description="Weekly/monthly only: the single clock time, e.g. '09:00' or '5:30 PM'.")]


@mcp.tool(annotations=WRITE)
def create_recurring_task(
    name: Annotated[str, Field(description="Title given to every generated task.", min_length=1)],
    schedule_type: _ScheduleType,
    times: _Times = None,
    days: _Days = None,
    time: _Time = None,
    notes: Annotated[str | None, Field(description="Optional notes copied onto every generated task.")] = None,
) -> dict[str, Any]:
    """Create a recurring task rule.

    Tabula keeps the next occurrence visible in the task list ahead of time and generates today's
    occurrences immediately. Examples:
      - twice daily:      schedule_type='daily',   times=['09:00', '21:00']
      - Mon/Wed/Fri 8am:  schedule_type='weekly',  days=['mon', 'wed', 'fri'], time='08:00'
      - 1st and 15th 5pm: schedule_type='monthly', days=[1, 15], time='17:00'
    """
    _reject_irrelevant(schedule_type, times, days, time)
    schedule = _build_schedule(schedule_type, times, days, time)
    rule = _request(
        "POST",
        "/api/recurring",
        {"name": name, "notes": notes, "schedule_type": schedule_type, "schedule": schedule},
    )
    result = _rule_view(rule)
    result["next_occurrence"] = _next_occurrence(rule["id"])
    return result


@mcp.tool(annotations=WRITE_IDEMPOTENT)
def update_recurring_task(
    recurring_id: Annotated[int, Field(description="ID of the rule (from list_recurring_tasks or a task's recurring_task_id).")],
    name: Annotated[str | None, Field(description="New title.")] = None,
    notes: Annotated[str | None, Field(description="New notes. Pass an empty string to clear them.")] = None,
    schedule_type: Annotated[
        Literal["daily", "weekly", "monthly"] | None,
        Field(description="Only needed to switch to a different kind of schedule."),
    ] = None,
    times: _Times = None,
    days: _Days = None,
    time: _Time = None,
) -> dict[str, Any]:
    """Change a recurring rule's name, notes or schedule. Omitted fields keep their current value.

    When the schedule stays the same type you can change just one part (e.g. only `time`). Saving
    replaces the rule's not-yet-due preview task so it reflects the change; tasks that are already
    due or past are left alone.
    """
    existing = _request("GET", f"/api/recurring/{recurring_id}")
    body = {}
    if name is not None:
        body["name"] = name
    if notes is not None:
        body["notes"] = notes

    if any(v is not None for v in (schedule_type, times, days, time)):
        new_type = schedule_type or existing["schedule_type"]
        _reject_irrelevant(new_type, times, days, time)
        current = existing["schedule"] if new_type == existing["schedule_type"] else {}
        body["schedule_type"] = new_type
        body["schedule"] = _build_schedule(
            new_type,
            times if times is not None else current.get("times"),
            days if days is not None else current.get("days"),
            time if time is not None else current.get("time"),
        )
    if not body:
        raise TabulaError("Nothing to update: pass at least one of name, notes or a schedule field.")

    rule = _request("PATCH", f"/api/recurring/{recurring_id}", body)
    result = _rule_view(rule)
    result["next_occurrence"] = _next_occurrence(rule["id"])
    return result


@mcp.tool(annotations=DESTRUCTIVE)
def delete_recurring_task(
    recurring_id: Annotated[int, Field(description="ID of the rule to delete.")],
) -> dict[str, Any]:
    """Delete a recurring rule so it stops generating tasks.

    Tasks already generated from it are kept; remove them with delete_tasks if unwanted.
    """
    existing = _request("GET", f"/api/recurring/{recurring_id}")
    _request("DELETE", f"/api/recurring/{recurring_id}")
    return {
        "deleted": recurring_id,
        "name": existing["name"],
        "note": "Already-generated tasks were kept; delete them with delete_tasks if you don't want them.",
    }


if __name__ == "__main__":
    mcp.run()

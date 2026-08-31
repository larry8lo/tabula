(() => {
  const state = {
    tasks: [],
    selectedIds: new Set(),
  };

  // ---------- Elements ----------
  const taskListEl = document.getElementById("task-list");
  const emptyStateEl = document.getElementById("empty-state");
  const selectionCountEl = document.getElementById("selection-count");

  const btnBulkComplete = document.getElementById("btn-bulk-complete");
  const btnBulkCancel = document.getElementById("btn-bulk-cancel");
  const btnBulkDelete = document.getElementById("btn-bulk-delete");

  const btnNewTask = document.getElementById("btn-new-task");
  const modalNewTask = document.getElementById("modal-new-task");
  const newTaskName = document.getElementById("new-task-name");
  const newTaskDue = document.getElementById("new-task-due");
  const newTaskError = document.getElementById("new-task-error");
  const newTaskSave = document.getElementById("new-task-save");

  const btnQuickAdd = document.getElementById("btn-quick-add");
  const quickAddMenu = document.getElementById("quick-add-menu");
  const modalQuickAdd = document.getElementById("modal-quick-add");
  const quickAddName = document.getElementById("quick-add-name");
  const quickAddError = document.getElementById("quick-add-error");
  const quickAddSave = document.getElementById("quick-add-save");
  const quickAddPresetLabel = document.getElementById("quick-add-preset-label");

  const modalEditDue = document.getElementById("modal-edit-due");
  const editDueInput = document.getElementById("edit-due-input");
  const editDueError = document.getElementById("edit-due-error");
  const editDueSave = document.getElementById("edit-due-save");
  const editDueTaskName = document.getElementById("edit-due-task-name");

  const PRESET_LABELS = {
    "15m": "in 15 minutes",
    "1h": "in 1 hour",
    "4h": "in 4 hours",
    eod: "end of today",
    "3d": "in 3 days",
    eow: "end of week",
  };

  let pendingPreset = null;
  let editingTaskId = null;

  // ---------- API ----------
  async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  async function apiSend(url, method, body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try { msg = JSON.parse(text).error || text; } catch (e) {}
      throw new Error(msg || `Request failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------- Data loading ----------
  async function loadTasks() {
    state.tasks = await apiGet("/api/tasks");
    // Server already sorts by due_time asc, but keep client sort authoritative too.
    state.tasks.sort((a, b) => a.due_time.localeCompare(b.due_time));
    render();
  }

  // ---------- Formatting ----------
  function formatDue(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function toDatetimeLocalValue(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const STATUS_LABELS = {
    in_progress: "In Progress",
    complete: "Complete",
    canceled: "Canceled",
  };

  // ---------- Rendering ----------
  function render() {
    taskListEl.innerHTML = "";
    emptyStateEl.hidden = state.tasks.length > 0;

    const now = new Date();

    for (const task of state.tasks) {
      const tr = document.createElement("tr");
      tr.className = `task-row status-${task.status}`;
      tr.dataset.id = task.id;
      if (state.selectedIds.has(task.id)) tr.classList.add("selected");

      // Name cell
      const tdName = document.createElement("td");
      const nameBtn = document.createElement("button");
      nameBtn.className = "task-name-btn";
      nameBtn.textContent = task.name;
      nameBtn.title = "Click to change due date";
      nameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditDueModal(task);
      });
      tdName.appendChild(nameBtn);

      // Due cell
      const tdDue = document.createElement("td");
      tdDue.className = "due-cell";
      const dueDate = new Date(task.due_time);
      if (task.status === "in_progress" && dueDate < now) {
        tdDue.classList.add("overdue");
      }
      tdDue.textContent = formatDue(task.due_time);

      // Status cell
      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge badge-${task.status}`;
      badge.textContent = STATUS_LABELS[task.status] || task.status;
      tdStatus.appendChild(badge);

      // Actions cell
      const tdActions = document.createElement("td");
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "row-actions";

      const completeBtn = iconButton("✓", "icon-complete", "Mark complete", (e) => {
        e.stopPropagation();
        setStatus([task.id], "complete");
      });
      const cancelBtn = iconButton("⦸", "icon-cancel", "Cancel task", (e) => {
        e.stopPropagation();
        setStatus([task.id], "cancel");
      });
      const deleteBtn = iconButton("🗑", "icon-delete", "Delete task", (e) => {
        e.stopPropagation();
        deleteTasks([task.id]);
      });

      actionsWrap.append(completeBtn, cancelBtn, deleteBtn);
      tdActions.appendChild(actionsWrap);

      tr.append(tdName, tdDue, tdStatus, tdActions);

      // Row selection: clicking whitespace (the row itself, not interactive children)
      tr.addEventListener("click", () => toggleSelection(task.id));

      taskListEl.appendChild(tr);
    }

    updateBulkToolbar();
  }

  function iconButton(label, extraClass, title, onClick) {
    const btn = document.createElement("button");
    btn.className = `icon-btn ${extraClass}`;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function toggleSelection(id) {
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
    } else {
      state.selectedIds.add(id);
    }
    render();
  }

  function updateBulkToolbar() {
    const count = state.selectedIds.size;
    const hasSelection = count > 0;
    btnBulkComplete.disabled = !hasSelection;
    btnBulkCancel.disabled = !hasSelection;
    btnBulkDelete.disabled = !hasSelection;
    selectionCountEl.hidden = !hasSelection;
    selectionCountEl.textContent = hasSelection ? `${count} selected` : "";
  }

  // ---------- Mutations ----------
  async function setStatus(ids, action) {
    // action is "complete" or "cancel"; the DB status value for cancel is "canceled"
    const statusValue = action === "complete" ? "complete" : "canceled";
    if (ids.length === 1) {
      await apiSend(`/api/tasks/${ids[0]}`, "PATCH", { status: statusValue });
    } else {
      await apiSend("/api/tasks/bulk", "POST", { ids, action });
    }
    clearSelectionFor(ids);
    await loadTasks();
  }

  async function deleteTasks(ids) {
    if (ids.length === 1) {
      await apiSend(`/api/tasks/${ids[0]}`, "DELETE");
    } else {
      await apiSend("/api/tasks/bulk", "POST", { ids, action: "delete" });
    }
    clearSelectionFor(ids);
    await loadTasks();
  }

  function clearSelectionFor(ids) {
    for (const id of ids) state.selectedIds.delete(id);
  }

  // ---------- Modal helpers ----------
  function openModal(modalEl) { modalEl.hidden = false; }
  function closeModal(modalEl) { modalEl.hidden = true; }

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay").hidden = true;
    });
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });

  // ---------- New task modal ----------
  btnNewTask.addEventListener("click", () => {
    newTaskName.value = "";
    newTaskDue.value = "";
    newTaskError.hidden = true;
    openModal(modalNewTask);
    newTaskName.focus();
  });

  newTaskSave.addEventListener("click", async () => {
    const name = newTaskName.value.trim();
    const due = newTaskDue.value;
    if (!name || !due) {
      newTaskError.textContent = "Please enter a task name and due date.";
      newTaskError.hidden = false;
      return;
    }
    try {
      await apiSend("/api/tasks", "POST", { name, due_time: new Date(due).toISOString() });
      closeModal(modalNewTask);
      await loadTasks();
    } catch (err) {
      newTaskError.textContent = err.message;
      newTaskError.hidden = false;
    }
  });

  // ---------- Quick add dropdown + modal ----------
  btnQuickAdd.addEventListener("click", (e) => {
    e.stopPropagation();
    quickAddMenu.hidden = !quickAddMenu.hidden;
  });
  document.addEventListener("click", () => { quickAddMenu.hidden = true; });

  quickAddMenu.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      pendingPreset = item.dataset.preset;
      quickAddPresetLabel.textContent = `(${PRESET_LABELS[pendingPreset]})`;
      quickAddName.value = "";
      quickAddError.hidden = true;
      quickAddMenu.hidden = true;
      openModal(modalQuickAdd);
      quickAddName.focus();
    });
  });

  quickAddSave.addEventListener("click", async () => {
    const name = quickAddName.value.trim();
    if (!name) {
      quickAddError.textContent = "Please enter a task name.";
      quickAddError.hidden = false;
      return;
    }
    try {
      await apiSend("/api/tasks/quick", "POST", { name, preset: pendingPreset });
      closeModal(modalQuickAdd);
      await loadTasks();
    } catch (err) {
      quickAddError.textContent = err.message;
      quickAddError.hidden = false;
    }
  });

  // ---------- Edit due date modal ----------
  function openEditDueModal(task) {
    editingTaskId = task.id;
    editDueTaskName.textContent = task.name;
    editDueInput.value = toDatetimeLocalValue(task.due_time);
    editDueError.hidden = true;
    openModal(modalEditDue);
    editDueInput.focus();
  }

  editDueSave.addEventListener("click", async () => {
    const due = editDueInput.value;
    if (!due) {
      editDueError.textContent = "Please choose a due date.";
      editDueError.hidden = false;
      return;
    }
    try {
      await apiSend(`/api/tasks/${editingTaskId}`, "PATCH", { due_time: new Date(due).toISOString() });
      closeModal(modalEditDue);
      await loadTasks();
    } catch (err) {
      editDueError.textContent = err.message;
      editDueError.hidden = false;
    }
  });

  // ---------- Bulk toolbar ----------
  btnBulkComplete.addEventListener("click", () => setStatus([...state.selectedIds], "complete"));
  btnBulkCancel.addEventListener("click", () => setStatus([...state.selectedIds], "cancel"));
  btnBulkDelete.addEventListener("click", () => deleteTasks([...state.selectedIds]));

  // ---------- Init ----------
  loadTasks();
})();

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

  const modalNewTask = document.getElementById("modal-new-task");
  const newTaskName = document.getElementById("new-task-name");
  const newTaskDueField = document.getElementById("new-task-due-field");
  const newTaskNotes = document.getElementById("new-task-notes");
  const newTaskError = document.getElementById("new-task-error");
  const newTaskSave = document.getElementById("new-task-save");

  const btnQuickAdd = document.getElementById("btn-quick-add");
  const btnQuickAddCustom = document.getElementById("btn-quick-add-custom");
  const quickAddMenu = document.getElementById("quick-add-menu");
  const modalQuickAdd = document.getElementById("modal-quick-add");
  const quickAddName = document.getElementById("quick-add-name");
  const quickAddError = document.getElementById("quick-add-error");
  const quickAddSave = document.getElementById("quick-add-save");
  const quickAddPresetLabel = document.getElementById("quick-add-preset-label");

  const modalEditDue = document.getElementById("modal-edit-due");
  const editNotesInput = document.getElementById("edit-notes-input");
  const editDueError = document.getElementById("edit-due-error");
  const editDueSave = document.getElementById("edit-due-save");
  const editDueTaskName = document.getElementById("edit-due-task-name");

  const notesPopup = document.getElementById("notes-popup");
  const notesPopupContent = document.getElementById("notes-popup-content");

  const statusPopover = document.getElementById("status-popover");

  const PRESET_LABELS = {
    "15m": "in 15 minutes",
    "1h": "in 1 hour",
    "4h": "in 4 hours",
    eod: "end of today",
    eot: "end of tomorrow",
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

  // ---------- Custom date-time picker (renders identically across browsers,
  // unlike native <input type="datetime-local"> which varies a lot) ----------
  const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const MONTH_LABELS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const allDateTimePickers = [];
  function closeAllDateTimePopovers() {
    allDateTimePickers.forEach((p) => p.closePopover());
  }

  function createDateTimePicker({ container, onChange } = {}) {
    let selected = null; // Date | null
    let viewDate = new Date();
    let silent = false; // suppress onChange while setting the value programmatically

    let trigger = null;
    if (container) {
      container.className = "datetime-field";
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "datetime-trigger";
    }

    const popover = document.createElement("div");
    popover.className = "datetime-popover";
    popover.hidden = true;
    document.body.appendChild(popover);

    const nav = document.createElement("div");
    nav.className = "datetime-nav";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "datetime-nav-btn";
    prevBtn.textContent = "‹";
    const monthLabel = document.createElement("span");
    monthLabel.className = "datetime-month-label";
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "datetime-nav-btn";
    nextBtn.textContent = "›";
    nav.append(prevBtn, monthLabel, nextBtn);

    const weekdayRow = document.createElement("div");
    weekdayRow.className = "datetime-weekdays";
    WEEKDAY_LABELS.forEach((label) => {
      const el = document.createElement("span");
      el.textContent = label;
      weekdayRow.appendChild(el);
    });

    const grid = document.createElement("div");
    grid.className = "datetime-grid";

    const timeRow = document.createElement("div");
    timeRow.className = "datetime-time-row";
    const hourSelect = document.createElement("select");
    hourSelect.className = "datetime-select";
    for (let h = 1; h <= 12; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = String(h);
      hourSelect.appendChild(opt);
    }
    const colon = document.createElement("span");
    colon.className = "datetime-colon";
    colon.textContent = ":";
    const minuteSelect = document.createElement("select");
    minuteSelect.className = "datetime-select";
    for (let m = 0; m < 60; m++) {
      const opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = String(m).padStart(2, "0");
      minuteSelect.appendChild(opt);
    }
    const ampmSelect = document.createElement("select");
    ampmSelect.className = "datetime-select";
    ["AM", "PM"].forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      ampmSelect.appendChild(opt);
    });
    timeRow.append(hourSelect, colon, minuteSelect, ampmSelect);

    popover.append(nav, weekdayRow, grid, timeRow);
    if (trigger) container.appendChild(trigger);

    function notifyChange() {
      if (!silent && onChange && selected) onChange(selected.toISOString());
    }

    function ensureSelected() {
      if (!selected) {
        selected = new Date(viewDate);
        selected.setHours(9, 0, 0, 0);
      }
    }

    function renderTrigger() {
      if (!trigger) return;
      if (!selected) {
        trigger.textContent = "Select date & time";
        trigger.classList.add("is-empty");
      } else {
        trigger.textContent = selected.toLocaleString(undefined, {
          month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
        });
        trigger.classList.remove("is-empty");
      }
    }

    function renderCalendar() {
      monthLabel.textContent = `${MONTH_LABELS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
      grid.textContent = "";
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const today = new Date();
      for (let i = 0; i < firstDay; i++) {
        grid.appendChild(document.createElement("span"));
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "datetime-day";
        btn.textContent = String(d);
        if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === d) {
          btn.classList.add("is-today");
        }
        if (selected && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === d) {
          btn.classList.add("is-selected");
        }
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          ensureSelected();
          selected.setFullYear(year, month, d);
          renderAll();
          notifyChange();
        });
        grid.appendChild(btn);
      }
    }

    function renderTime() {
      const base = selected || new Date();
      const hour24 = base.getHours();
      const meridiem = hour24 >= 12 ? "PM" : "AM";
      let hour12 = hour24 % 12;
      if (hour12 === 0) hour12 = 12;
      hourSelect.value = String(hour12);
      minuteSelect.value = String(base.getMinutes());
      ampmSelect.value = meridiem;
    }

    function applyTimeChange() {
      ensureSelected();
      let hour12 = parseInt(hourSelect.value, 10);
      const minute = parseInt(minuteSelect.value, 10);
      let hour24 = hour12 % 12;
      if (ampmSelect.value === "PM") hour24 += 12;
      selected.setHours(hour24, minute, 0, 0);
      renderAll();
      notifyChange();
    }

    [hourSelect, minuteSelect, ampmSelect].forEach((sel) => {
      sel.addEventListener("click", (e) => e.stopPropagation());
      sel.addEventListener("change", (e) => {
        e.stopPropagation();
        applyTimeChange();
      });
    });

    function renderAll() {
      renderTrigger();
      renderCalendar();
      renderTime();
    }

    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      viewDate.setMonth(viewDate.getMonth() - 1);
      renderCalendar();
    });
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      viewDate.setMonth(viewDate.getMonth() + 1);
      renderCalendar();
    });

    function openPopoverAt(anchorRect) {
      closeAllDateTimePopovers();
      closeNotesPopup();
      closeStatusPopover();
      popover.hidden = false;
      popover.style.top = `${anchorRect.bottom + 6}px`;
      popover.style.left = `${anchorRect.left}px`;
      requestAnimationFrame(() => {
        const popRect = popover.getBoundingClientRect();
        const overflow = popRect.right - (window.innerWidth - 8);
        if (overflow > 0) {
          popover.style.left = `${Math.max(8, anchorRect.left - overflow)}px`;
        }
      });
    }
    function closePopover() {
      popover.hidden = true;
    }

    if (trigger) {
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popover.hidden) openPopoverAt(trigger.getBoundingClientRect()); else closePopover();
      });
    }
    popover.addEventListener("click", (e) => e.stopPropagation());

    renderAll();

    const api = {
      getISOString() {
        return selected ? selected.toISOString() : "";
      },
      setISOString(iso) {
        silent = true;
        const d = iso ? new Date(iso) : null;
        selected = d && !Number.isNaN(d.getTime()) ? d : null;
        viewDate = selected ? new Date(selected) : new Date();
        renderAll();
        silent = false;
      },
      reset() {
        silent = true;
        selected = null;
        viewDate = new Date();
        renderAll();
        silent = false;
      },
      openNear(anchorEl) {
        openPopoverAt(anchorEl.getBoundingClientRect());
      },
      closePopover,
      isOpen() {
        return !popover.hidden;
      },
      focus() {
        if (trigger) trigger.focus();
      },
    };
    allDateTimePickers.push(api);
    return api;
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
      const isOverdue = task.status === "in_progress" && new Date(task.due_time) < now;
      if (isOverdue) tr.classList.add("overdue");

      // Name cell
      const tdName = document.createElement("td");
      if (editingNameId === task.id) {
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "task-name-input";
        nameInput.value = task.name;
        nameInput.addEventListener("click", (e) => e.stopPropagation());
        nameInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            commitNameEdit(task, nameInput.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelNameEdit();
          }
        });
        nameInput.addEventListener("blur", () => commitNameEdit(task, nameInput.value));
        tdName.appendChild(nameInput);
      } else {
        const nameBtn = document.createElement("button");
        nameBtn.className = "task-name-btn";
        nameBtn.textContent = task.name;
        nameBtn.title = "Click to rename";
        nameBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          editingNameId = task.id;
          render();
        });
        tdName.appendChild(nameBtn);
        if (task.notes) {
          const notesIcon = document.createElement("button");
          notesIcon.type = "button";
          notesIcon.className = "notes-indicator";
          notesIcon.textContent = "📝";
          notesIcon.setAttribute("aria-label", "View notes");
          notesIcon.addEventListener("click", (e) => {
            e.stopPropagation();
            openNotesPopup(notesIcon, task);
          });
          tdName.appendChild(notesIcon);
        }
      }

      // Due cell
      const tdDue = document.createElement("td");
      tdDue.className = "due-cell";
      const dueBtn = document.createElement("button");
      dueBtn.type = "button";
      dueBtn.className = "due-cell-btn";
      dueBtn.textContent = formatDue(task.due_time);
      dueBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openInlineDuePicker(dueBtn, task);
      });
      tdDue.appendChild(dueBtn);

      // Status cell
      const tdStatus = document.createElement("td");
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = `badge badge-${task.status}`;
      badge.textContent = STATUS_LABELS[task.status] || task.status;
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        openStatusPopover(badge, task);
      });
      tdStatus.appendChild(badge);

      // Actions cell
      const tdActions = document.createElement("td");
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "row-actions";

      const editBtn = iconButton("✎", "icon-edit", "Edit notes", (e) => {
        e.stopPropagation();
        openEditNotesModal(task);
      });
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

      actionsWrap.append(editBtn, completeBtn, cancelBtn, deleteBtn);
      tdActions.appendChild(actionsWrap);

      tr.append(tdName, tdDue, tdStatus, tdActions);

      // Row selection: clicking whitespace (the row itself, not interactive children)
      tr.addEventListener("click", () => toggleSelection(task.id));

      taskListEl.appendChild(tr);
    }

    if (editingNameId !== null) {
      const activeInput = taskListEl.querySelector(".task-name-input");
      if (activeInput) {
        activeInput.focus();
        activeInput.select();
      }
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
  function openModal(modalEl) {
    closeNotesPopup();
    closeAllDateTimePopovers();
    closeStatusPopover();
    modalEl.hidden = false;
  }
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
  document.addEventListener("click", () => closeAllDateTimePopovers());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (allDateTimePickers.some((p) => p.isOpen())) {
      closeAllDateTimePopovers();
      return;
    }
    const openOverlay = document.querySelector(".modal-overlay:not([hidden])");
    if (openOverlay) {
      openOverlay.hidden = true;
      return;
    }
    if (editingNameId !== null) {
      cancelNameEdit();
      return;
    }
    closeNotesPopup();
    closeStatusPopover();
  });

  // ---------- Notes popup ----------
  function linkifyNotes(container, text) {
    container.textContent = "";
    const urlPattern = /https?:\/\/[^\s]+/g;
    let lastIndex = 0;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      let url = match[0];
      const trailingMatch = url.match(/[.,;:!?)\]}'"]+$/);
      if (trailingMatch) url = url.slice(0, url.length - trailingMatch[0].length);
      if (!url) continue;
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const a = document.createElement("a");
      a.href = url;
      a.textContent = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      container.appendChild(a);
      lastIndex = match.index + url.length;
    }
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function openNotesPopup(anchorEl, task) {
    if (!task.notes) return;
    linkifyNotes(notesPopupContent, task.notes);
    notesPopup.hidden = false;
    const rect = anchorEl.getBoundingClientRect();
    notesPopup.style.top = `${rect.bottom + 6}px`;
    notesPopup.style.left = `${rect.left}px`;
    requestAnimationFrame(() => {
      const popupRect = notesPopup.getBoundingClientRect();
      const overflow = popupRect.right - (window.innerWidth - 8);
      if (overflow > 0) {
        notesPopup.style.left = `${Math.max(8, rect.left - overflow)}px`;
      }
    });
  }

  function closeNotesPopup() {
    notesPopup.hidden = true;
  }

  document.addEventListener("click", (e) => {
    if (!notesPopup.hidden && !notesPopup.contains(e.target)) closeNotesPopup();
  });

  // ---------- New task modal ----------
  const newTaskDuePicker = createDateTimePicker({ container: newTaskDueField });

  function openNewTaskModal() {
    newTaskName.value = "";
    newTaskDuePicker.reset();
    newTaskNotes.value = "";
    newTaskError.hidden = true;
    openModal(modalNewTask);
    newTaskName.focus();
  }

  newTaskSave.addEventListener("click", async () => {
    const name = newTaskName.value.trim();
    const due = newTaskDuePicker.getISOString();
    const notes = newTaskNotes.value.trim();
    if (!name || !due) {
      newTaskError.textContent = "Please enter a task name and due date.";
      newTaskError.hidden = false;
      return;
    }
    try {
      await apiSend("/api/tasks", "POST", { name, due_time: due, notes });
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

  quickAddMenu.querySelectorAll(".dropdown-item[data-preset]").forEach((item) => {
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

  btnQuickAddCustom.addEventListener("click", (e) => {
    e.stopPropagation();
    quickAddMenu.hidden = true;
    openNewTaskModal();
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

  // ---------- Edit notes modal ----------
  function openEditNotesModal(task) {
    editingTaskId = task.id;
    editDueTaskName.textContent = task.name;
    editNotesInput.value = task.notes || "";
    editDueError.hidden = true;
    openModal(modalEditDue);
    editNotesInput.focus();
  }

  editDueSave.addEventListener("click", async () => {
    const notes = editNotesInput.value.trim();
    try {
      await apiSend(`/api/tasks/${editingTaskId}`, "PATCH", { notes });
      closeModal(modalEditDue);
      await loadTasks();
    } catch (err) {
      editDueError.textContent = err.message;
      editDueError.hidden = false;
    }
  });

  // ---------- Inline due-date editing ----------
  let dueEditingTaskId = null;
  const inlineDuePicker = createDateTimePicker({
    onChange: async (iso) => {
      if (dueEditingTaskId == null) return;
      try {
        await apiSend(`/api/tasks/${dueEditingTaskId}`, "PATCH", { due_time: iso });
        await loadTasks();
      } catch (err) {
        console.error(err);
      }
    },
  });

  function openInlineDuePicker(anchorEl, task) {
    dueEditingTaskId = task.id;
    inlineDuePicker.setISOString(task.due_time);
    inlineDuePicker.openNear(anchorEl);
  }

  // ---------- Inline status editing ----------
  let statusEditingTaskId = null;

  function openStatusPopover(anchorEl, task) {
    closeNotesPopup();
    closeAllDateTimePopovers();
    statusEditingTaskId = task.id;
    statusPopover.hidden = false;
    const rect = anchorEl.getBoundingClientRect();
    statusPopover.style.top = `${rect.bottom + 6}px`;
    statusPopover.style.left = `${rect.left}px`;
  }

  function closeStatusPopover() {
    statusPopover.hidden = true;
    statusEditingTaskId = null;
  }

  statusPopover.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const taskId = statusEditingTaskId;
      closeStatusPopover();
      if (taskId == null) return;
      await apiSend(`/api/tasks/${taskId}`, "PATCH", { status: btn.dataset.status });
      await loadTasks();
    });
  });

  document.addEventListener("click", (e) => {
    if (!statusPopover.hidden && !statusPopover.contains(e.target)) closeStatusPopover();
  });

  // ---------- Inline name editing ----------
  let editingNameId = null;

  async function commitNameEdit(task, rawValue) {
    if (editingNameId !== task.id) return;
    editingNameId = null;
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === task.name) {
      render();
      return;
    }
    render();
    try {
      await apiSend(`/api/tasks/${task.id}`, "PATCH", { name: trimmed });
      await loadTasks();
    } catch (err) {
      console.error(err);
      await loadTasks();
    }
  }

  function cancelNameEdit() {
    editingNameId = null;
    render();
  }

  // ---------- Bulk toolbar ----------
  btnBulkComplete.addEventListener("click", () => setStatus([...state.selectedIds], "complete"));
  btnBulkCancel.addEventListener("click", () => setStatus([...state.selectedIds], "cancel"));
  btnBulkDelete.addEventListener("click", () => deleteTasks([...state.selectedIds]));

  // ---------- Init ----------
  loadTasks();
})();

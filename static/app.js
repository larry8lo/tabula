(() => {
  const state = {
    tasks: [],
    selectedIds: new Set(),
    expandedIds: new Set(),
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
  const quickAddNotes = document.getElementById("quick-add-notes");
  const quickAddError = document.getElementById("quick-add-error");
  const quickAddSave = document.getElementById("quick-add-save");
  const quickAddPresetLabel = document.getElementById("quick-add-preset-label");

  const modalEditDue = document.getElementById("modal-edit-due");
  const editTaskNameInput = document.getElementById("edit-task-name-input");
  const editDueField = document.getElementById("edit-due-field");
  const editNotesInput = document.getElementById("edit-notes-input");
  const editDueError = document.getElementById("edit-due-error");
  const editDueSave = document.getElementById("edit-due-save");

  const btnRecurring = document.getElementById("btn-recurring");
  const recurringMenu = document.getElementById("recurring-menu");
  const btnManageRecurring = document.getElementById("btn-manage-recurring");
  const modalRecurring = document.getElementById("modal-recurring");
  const recurringModalHeading = document.getElementById("recurring-modal-heading");
  const recurringEditTaskName = document.getElementById("recurring-edit-task-name");
  const recurringTypeLabel = document.getElementById("recurring-type-label");
  const recurringNameField = document.getElementById("recurring-name-field");
  const recurringNotesField = document.getElementById("recurring-notes-field");
  const recurringName = document.getElementById("recurring-name");
  const recurringNotes = document.getElementById("recurring-notes");
  const recurringScheduleFields = document.getElementById("recurring-schedule-fields");
  const recurringError = document.getElementById("recurring-error");
  const recurringSave = document.getElementById("recurring-save");
  const modalManageRecurring = document.getElementById("modal-manage-recurring");
  const recurringList = document.getElementById("recurring-list");
  const recurringListEmpty = document.getElementById("recurring-list-empty");

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

      // Expand cell (notes disclosure triangle)
      const tdExpand = document.createElement("td");
      tdExpand.className = "expand-cell";
      if (task.notes) {
        const isExpanded = state.expandedIds.has(task.id);
        const expandBtn = document.createElement("button");
        expandBtn.type = "button";
        expandBtn.className = "expand-btn";
        expandBtn.textContent = isExpanded ? "▼" : "▶";
        expandBtn.setAttribute("aria-label", isExpanded ? "Hide notes" : "Show notes");
        expandBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleExpanded(task.id);
        });
        tdExpand.appendChild(expandBtn);
      }

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
        if (task.recurring_task_id) {
          const recurringIcon = document.createElement("span");
          recurringIcon.className = "recurring-indicator";
          recurringIcon.textContent = "↻";
          recurringIcon.title = "Recurring task";
          tdName.appendChild(recurringIcon);
        }
      }

      // Due cell
      const tdDue = document.createElement("td");
      tdDue.className = "due-cell";
      const dueBtn = document.createElement("button");
      dueBtn.type = "button";
      dueBtn.className = "due-cell-btn";
      dueBtn.textContent = formatDue(task.due_time);
      if (task.recurring_task_id) {
        dueBtn.title = "Click to edit recurring schedule";
        dueBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openEditRecurringModalForTask(task);
        });
      } else {
        dueBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openInlineDuePicker(dueBtn, task);
        });
      }
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

      const editBtn = iconButton("✎", "icon-edit", "Edit task", (e) => {
        e.stopPropagation();
        if (task.recurring_task_id) {
          openEditRecurringModalForTask(task, { fullEdit: true });
        } else {
          openEditTaskModal(task);
        }
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

      tr.append(tdExpand, tdName, tdDue, tdStatus, tdActions);

      // Row selection: clicking whitespace (the row itself, not interactive children)
      tr.addEventListener("click", () => toggleSelection(task.id));

      taskListEl.appendChild(tr);

      if (task.notes && state.expandedIds.has(task.id)) {
        const noteRow = document.createElement("tr");
        noteRow.className = "note-row";
        const noteCell = document.createElement("td");
        noteCell.colSpan = 5;
        linkifyNotes(noteCell, task.notes);
        noteRow.appendChild(noteCell);
        taskListEl.appendChild(noteRow);
      }
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

  function toggleExpanded(id) {
    if (state.expandedIds.has(id)) {
      state.expandedIds.delete(id);
    } else {
      state.expandedIds.add(id);
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
    closeStatusPopover();
  });

  // ---------- Notes rendering (used by the expandable note row) ----------
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
      quickAddNotes.value = "";
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
    const notes = quickAddNotes.value.trim();
    if (!name) {
      quickAddError.textContent = "Please enter a task name.";
      quickAddError.hidden = false;
      return;
    }
    try {
      await apiSend("/api/tasks/quick", "POST", { name, preset: pendingPreset, notes });
      closeModal(modalQuickAdd);
      await loadTasks();
    } catch (err) {
      quickAddError.textContent = err.message;
      quickAddError.hidden = false;
    }
  });

  // ---------- Edit task modal (one-time tasks: name, due date, notes) ----------
  const editTaskDuePicker = createDateTimePicker({ container: editDueField });

  function openEditTaskModal(task) {
    editingTaskId = task.id;
    editTaskNameInput.value = task.name;
    editTaskDuePicker.setISOString(task.due_time);
    editNotesInput.value = task.notes || "";
    editDueError.hidden = true;
    openModal(modalEditDue);
    editTaskNameInput.focus();
  }

  editDueSave.addEventListener("click", async () => {
    const name = editTaskNameInput.value.trim();
    const due = editTaskDuePicker.getISOString();
    const notes = editNotesInput.value.trim();
    if (!name) {
      editDueError.textContent = "Please enter a task name.";
      editDueError.hidden = false;
      return;
    }
    if (!due) {
      editDueError.textContent = "Please choose a due date.";
      editDueError.hidden = false;
      return;
    }
    try {
      await apiSend(`/api/tasks/${editingTaskId}`, "PATCH", { name, due_time: due, notes });
      closeModal(modalEditDue);
      await loadTasks();
    } catch (err) {
      editDueError.textContent = err.message;
      editDueError.hidden = false;
    }
  });

  // ---------- Recurring tasks ----------
  const WEEKDAY_FULL_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const RECURRING_TYPE_LABELS = {
    daily: "1 or N times every day",
    weekly: "days in a week",
    monthly: "days in a month",
  };

  function createTimeSelect(initialHHMM) {
    const wrap = document.createElement("div");
    wrap.className = "time-select-group";

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
    wrap.append(hourSelect, colon, minuteSelect, ampmSelect);

    function setValue(hhmm) {
      const [hh, mm] = hhmm.split(":").map(Number);
      let hour12 = hh % 12;
      if (hour12 === 0) hour12 = 12;
      hourSelect.value = String(hour12);
      minuteSelect.value = String(mm);
      ampmSelect.value = hh >= 12 ? "PM" : "AM";
    }
    function getValue() {
      let hour12 = parseInt(hourSelect.value, 10);
      const minute = parseInt(minuteSelect.value, 10);
      let hour24 = hour12 % 12;
      if (ampmSelect.value === "PM") hour24 += 12;
      return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    setValue(initialHHMM || "09:00");

    return { el: wrap, getValue, setValue };
  }

  function buildDailyScheduleFields(container, initialTimes) {
    const timeRows = [];
    const list = document.createElement("div");
    list.className = "recurring-time-list";
    container.appendChild(list);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn recurring-add-time";
    addBtn.textContent = "+ Add another time";
    container.appendChild(addBtn);

    function updateRemoveButtons() {
      list.querySelectorAll(".recurring-remove-time").forEach((btn) => {
        btn.hidden = timeRows.length <= 1;
      });
    }

    function addRow(initial) {
      const row = document.createElement("div");
      row.className = "recurring-time-row";
      const timeSelect = createTimeSelect(initial);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "recurring-remove-time";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        if (timeRows.length <= 1) return;
        const idx = timeRows.findIndex((r) => r.rowEl === row);
        if (idx !== -1) timeRows.splice(idx, 1);
        row.remove();
        updateRemoveButtons();
      });
      row.append(timeSelect.el, removeBtn);
      list.appendChild(row);
      timeRows.push({ rowEl: row, timeSelect });
      updateRemoveButtons();
    }

    addBtn.addEventListener("click", () => addRow("09:00"));
    const seedTimes = initialTimes && initialTimes.length ? initialTimes : ["09:00"];
    seedTimes.forEach((t) => addRow(t));

    return {
      getSchedule() {
        return { times: timeRows.map((r) => r.timeSelect.getValue()) };
      },
    };
  }

  function buildDayToggleSchedule(container, dayLabels, dayValues, gridClass, initial) {
    const toggles = [];
    const grid = document.createElement("div");
    grid.className = `recurring-day-toggles ${gridClass}`;
    const initialDays = (initial && initial.days) || [];
    dayLabels.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-toggle";
      btn.textContent = label;
      if (initialDays.includes(dayValues[i])) btn.classList.add("is-selected");
      btn.addEventListener("click", () => btn.classList.toggle("is-selected"));
      grid.appendChild(btn);
      toggles.push({ value: dayValues[i], btn });
    });
    container.appendChild(grid);

    const timeSelect = createTimeSelect((initial && initial.time) || "09:00");
    const timeWrap = document.createElement("div");
    timeWrap.className = "recurring-time-row";
    timeWrap.appendChild(timeSelect.el);
    container.appendChild(timeWrap);

    return {
      getSchedule() {
        const days = toggles.filter((d) => d.btn.classList.contains("is-selected")).map((d) => d.value);
        return { days, time: timeSelect.getValue() };
      },
    };
  }

  function buildWeeklyScheduleFields(container, initial) {
    return buildDayToggleSchedule(
      container,
      WEEKDAY_FULL_LABELS,
      [0, 1, 2, 3, 4, 5, 6],
      "recurring-weekday-toggles",
      initial
    );
  }

  function buildMonthlyScheduleFields(container, initial) {
    const values = Array.from({ length: 31 }, (_, i) => i + 1);
    return buildDayToggleSchedule(container, values, values, "recurring-monthday-toggles", initial);
  }

  let recurringScheduleType = null;
  let currentScheduleBuilder = null;
  let editingRecurringId = null;
  let recurringFullEdit = false;

  function openRecurringModal(scheduleType, opts = {}) {
    recurringScheduleType = scheduleType;
    editingRecurringId = opts.editId || null;
    recurringFullEdit = !!opts.fullEdit;
    recurringName.value = opts.name || "";
    recurringNotes.value = opts.notes || "";
    recurringError.hidden = true;
    recurringModalHeading.textContent = editingRecurringId ? "Edit Recurring Task" : "New Recurring Task";
    recurringSave.textContent = editingRecurringId ? "Save Changes" : "Create Recurring Task";
    recurringTypeLabel.textContent = `(${RECURRING_TYPE_LABELS[scheduleType]})`;

    // Editing via the due-date shortcut only changes the schedule; editing via
    // the ✎ button (fullEdit) also lets you change the name and notes.
    const scheduleOnly = !!editingRecurringId && !recurringFullEdit;
    recurringNameField.hidden = scheduleOnly;
    recurringNotesField.hidden = scheduleOnly;
    recurringEditTaskName.hidden = !scheduleOnly;
    recurringEditTaskName.textContent = scheduleOnly ? opts.name || "" : "";

    recurringScheduleFields.innerHTML = "";
    if (scheduleType === "daily") {
      currentScheduleBuilder = buildDailyScheduleFields(recurringScheduleFields, opts.schedule && opts.schedule.times);
    } else if (scheduleType === "weekly") {
      currentScheduleBuilder = buildWeeklyScheduleFields(recurringScheduleFields, opts.schedule);
    } else {
      currentScheduleBuilder = buildMonthlyScheduleFields(recurringScheduleFields, opts.schedule);
    }
    openModal(modalRecurring);
    if (!scheduleOnly) recurringName.focus();
  }

  async function openEditRecurringModalForTask(task, opts = {}) {
    try {
      const rule = await apiGet(`/api/recurring/${task.recurring_task_id}`);
      openRecurringModal(rule.schedule_type, {
        editId: rule.id,
        name: rule.name,
        notes: rule.notes,
        schedule: rule.schedule,
        fullEdit: !!opts.fullEdit,
      });
    } catch (err) {
      console.error(err);
    }
  }

  btnRecurring.addEventListener("click", (e) => {
    e.stopPropagation();
    recurringMenu.hidden = !recurringMenu.hidden;
  });
  document.addEventListener("click", () => { recurringMenu.hidden = true; });

  recurringMenu.querySelectorAll("[data-schedule-type]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      recurringMenu.hidden = true;
      openRecurringModal(item.dataset.scheduleType);
    });
  });

  recurringSave.addEventListener("click", async () => {
    const needsName = !editingRecurringId || recurringFullEdit;
    if (needsName && !recurringName.value.trim()) {
      recurringError.textContent = "Please enter a task name.";
      recurringError.hidden = false;
      return;
    }
    const schedule = currentScheduleBuilder.getSchedule();
    if (recurringScheduleType === "daily" && !schedule.times.length) {
      recurringError.textContent = "Please add at least one time.";
      recurringError.hidden = false;
      return;
    }
    if (recurringScheduleType !== "daily" && !schedule.days.length) {
      recurringError.textContent = recurringScheduleType === "weekly"
        ? "Please select at least one day of the week."
        : "Please select at least one day of the month.";
      recurringError.hidden = false;
      return;
    }
    try {
      if (editingRecurringId) {
        const payload = { schedule_type: recurringScheduleType, schedule };
        if (recurringFullEdit) {
          payload.name = recurringName.value.trim();
          payload.notes = recurringNotes.value.trim();
        }
        await apiSend(`/api/recurring/${editingRecurringId}`, "PATCH", payload);
      } else {
        await apiSend("/api/recurring", "POST", {
          name: recurringName.value.trim(),
          notes: recurringNotes.value.trim(),
          schedule_type: recurringScheduleType,
          schedule,
        });
      }
      closeModal(modalRecurring);
      await loadTasks();
    } catch (err) {
      recurringError.textContent = err.message;
      recurringError.hidden = false;
    }
  });

  function formatTimeLabel(hhmm) {
    const [hh, mm] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function ordinal(n) {
    const suffixes = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }

  function summarizeSchedule(item) {
    const sched = item.schedule;
    if (item.schedule_type === "daily") {
      return `Daily at ${sched.times.map(formatTimeLabel).join(", ")}`;
    }
    if (item.schedule_type === "weekly") {
      const names = sched.days.map((d) => WEEKDAY_FULL_LABELS[d]).join(", ");
      return `Weekly on ${names} at ${formatTimeLabel(sched.time)}`;
    }
    const days = sched.days.map(ordinal).join(", ");
    return `Monthly on the ${days} at ${formatTimeLabel(sched.time)}`;
  }

  async function refreshRecurringList() {
    const items = await apiGet("/api/recurring");
    recurringList.innerHTML = "";
    recurringListEmpty.hidden = items.length > 0;
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "recurring-list-item";

      const info = document.createElement("div");
      info.className = "recurring-list-info";
      const nameEl = document.createElement("div");
      nameEl.className = "recurring-list-name";
      nameEl.textContent = item.name;
      const scheduleEl = document.createElement("div");
      scheduleEl.className = "recurring-list-schedule";
      scheduleEl.textContent = summarizeSchedule(item);
      info.append(nameEl, scheduleEl);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn icon-delete";
      deleteBtn.textContent = "🗑";
      deleteBtn.title = "Delete recurring task";
      deleteBtn.addEventListener("click", async () => {
        await apiSend(`/api/recurring/${item.id}`, "DELETE");
        await refreshRecurringList();
      });

      row.append(info, deleteBtn);
      recurringList.appendChild(row);
    }
  }

  btnManageRecurring.addEventListener("click", async (e) => {
    e.stopPropagation();
    recurringMenu.hidden = true;
    await refreshRecurringList();
    openModal(modalManageRecurring);
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

  // ---------- Refresh on regaining focus ----------
  // Catches changes made in another tab/window, or by the desktop-notification
  // poller, while this tab was in the background.
  function hasUnsavedInteraction() {
    if (editingNameId !== null) return true;
    if (document.querySelector(".modal-overlay:not([hidden])")) return true;
    if (allDateTimePickers.some((p) => p.isOpen())) return true;
    if (!statusPopover.hidden) return true;
    return false;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !hasUnsavedInteraction()) loadTasks();
  });
  window.addEventListener("focus", () => {
    if (!hasUnsavedInteraction()) loadTasks();
  });

  // ---------- Init ----------
  loadTasks();
})();

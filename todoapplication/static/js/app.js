// ============ Prioritise: small interactions ============

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Toasts: slide away by themselves
document.querySelectorAll('.toast').forEach((toast, i) => {
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 3200 + i * 300);
});

// 2. One-line welcome popup (only on the page right after login)
const modal = document.getElementById('welcome');
if (modal) {
    const hour = new Date().getHours();
    document.getElementById('greet').textContent =
        hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const close = () => { modal.classList.add('closing'); setTimeout(() => modal.remove(), 250); };
    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    setTimeout(close, 6000);                       // fades away by itself too
}

// 3. Add-task sheet: the + button opens it (if this page has one)
const sheet = document.getElementById('add-sheet');
function openSheet() {
    sheet.hidden = false;
    setTimeout(() => sheet.querySelector('input[name=title]').focus(), 50);
}
function closeSheet() { sheet.hidden = true; }
document.querySelectorAll('[data-open-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        if (!sheet) return;                        // no sheet here: follow the link to Home
        e.preventDefault();
        openSheet();
    });
});
if (sheet) {
    sheet.querySelector('[data-close-add]').addEventListener('click', closeSheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    if (new URLSearchParams(location.search).get('add') === '1') openSheet();
}

// 3b. Desktop: "Edit" opens the edit form in a centred dialog on top of the current page.
//     (On mobile, or if anything fails, the link just goes to the normal edit page.)
const desktop = window.matchMedia('(min-width: 900px)');
const X_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
let editDialog = null;
function closeEdit() { if (editDialog) { editDialog.remove(); editDialog = null; } }

document.addEventListener('click', async (e) => {
    const link = e.target.closest('.menu a[href*="edit_todo"]');
    if (!link || !desktop.matches || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    link.closest('.more')?.classList.remove('open');
    link.closest('.task')?.classList.remove('raised');
    try {
        const res = await fetch(link.href, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Edit page failed');
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const form = doc.querySelector('form.panel');
        if (!form) throw new Error('No form found');

        closeEdit();
        form.className = 'sheet';
        form.action = link.href;                               // post back to this task's edit URL
        form.insertAdjacentHTML('afterbegin',
            `<div class="sheet-head"><h2>Edit task</h2>
             <button class="icon-btn" type="button" data-close-edit aria-label="Close">${X_ICON}</button></div>`);
        form.querySelector('a.btn.ghost')?.addEventListener('click', (ev) => { ev.preventDefault(); closeEdit(); });
        form.querySelector('[data-close-edit]').addEventListener('click', closeEdit);

        editDialog = document.createElement('div');
        editDialog.className = 'sheet-backdrop';
        editDialog.append(form);
        editDialog.addEventListener('click', (ev) => { if (ev.target === editDialog) closeEdit(); });
        document.body.append(editDialog);
        form.querySelectorAll('.tp').forEach(renderTP);        // time picker inside the dialog
        form.querySelector('input[name=title]').focus();
    } catch {
        location.href = link.href;
    }
});

// 3c. Home: mini week calendar (the view only sends today's date, so we build the 7 days here)
const mini = document.querySelector('[data-mini-week]');
if (mini) {
    const [y, m, d] = mini.dataset.today.split('-').map(Number);
    const today = new Date(y, m - 1, d);
    const monday = new Date(y, m - 1, d - ((today.getDay() + 6) % 7));
    const pad = (n) => String(n).padStart(2, '0');
    for (let i = 0; i < 7; i++) {
        const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const iso = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
        const link = document.createElement('a');
        link.className = 'mw-day' + (day.getTime() === today.getTime() ? ' is-today' : '');
        link.href = `${mini.dataset.base}?day=${iso}`;
        link.innerHTML = `<small>${day.toLocaleDateString('en-GB', { weekday: 'short' })}</small><b>${day.getDate()}</b>`;
        mini.append(link);
    }
}

// 4. ⋯ menus: open one, close the others; click anywhere else to close
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.more-btn');
    document.querySelectorAll('.more.open').forEach((m) => {
        if (!btn || m !== btn.parentElement) {
            m.classList.remove('open');
            m.closest('.task').classList.remove('raised');
        }
    });
    if (btn) {
        const open = btn.parentElement.classList.toggle('open');
        btn.closest('.task').classList.toggle('raised', open);   // keep the menu above the next card
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.more.open').forEach((m) => {
        m.classList.remove('open');
        m.closest('.task').classList.remove('raised');
    });
    if (sheet && !sheet.hidden) closeSheet();
    closeEdit();
});

// 5. Colour presets on the Categories page
const colorInput = document.getElementById('color');
document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
        colorInput.value = btn.dataset.color;
        document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('on', b === btn));
    });
});
if (colorInput) {
    colorInput.addEventListener('input', () =>
        document.querySelectorAll('.preset').forEach((b) => b.classList.remove('on')));
}

// 6. Tick a task done / not done without reloading
document.querySelectorAll('.toggle-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const task = form.closest('.task');
        task.classList.toggle('done');                         // instant feedback
        try {
            const res = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'X-Requested-With': 'fetch' },
            });
            const data = await res.json();
            task.classList.toggle('done', data.done);          // trust the server's answer
            syncChips(form, data.done);
        } catch {
            location.reload();
        }
    });
});

// Month calendar: strike the task's chips in the grid through (or not) to match the row just ticked.
// A repeating task is ticked per day, so only the chip on the day being viewed changes.
function syncChips(form, done) {
    const id = new URL(form.action).pathname.split('/').pop();          // /toggle/<id>
    const day = form.querySelector('[name=date]')?.value;
    document.querySelectorAll(`.chip-t[data-task="${id}"]`).forEach((chip) => {
        if (chip.dataset.repeat && chip.dataset.day !== day) return;
        chip.classList.toggle('done', done);
    });
}

// 7. Knife-slice delete
const KNIFE_SVG = `
<svg viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="blade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#d9dde8"/><stop offset="1" stop-color="#9aa3b5"/>
    </linearGradient>
    <linearGradient id="handle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5b3df5"/><stop offset="1" stop-color="#2d1d8a"/>
    </linearGradient>
  </defs>
  <rect x="2" y="13" width="50" height="15" rx="6" fill="url(#handle)"/>
  <circle cx="16" cy="20.5" r="2" fill="#d9d0ff"/><circle cx="36" cy="20.5" r="2" fill="#d9d0ff"/>
  <rect x="50" y="11" width="6" height="19" rx="2" fill="#8b93a7"/>
  <path d="M56 10 H136 Q154 10 158 15 L150 21 Q118 30 56 30 Z" fill="url(#blade)" stroke="#aab2c5" stroke-width=".8"/>
  <path d="M60 13 H134" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".9"/>
</svg>`;

async function sliceTask(task) {
    const inner = task.querySelector('.task-inner');
    task.classList.add('slicing');
    task.style.setProperty('--w', (task.offsetWidth + 40) + 'px');

    // a) knife flies across, leaving a glowing cut line
    const knife = document.createElement('div');
    knife.className = 'knife';
    knife.innerHTML = KNIFE_SVG;
    const slash = document.createElement('div');
    slash.className = 'slash';
    task.append(slash, knife);
    await wait(480);

    // b) the card splits into two halves that fall apart
    const top = inner.cloneNode(true);
    const bottom = inner.cloneNode(true);
    top.classList.add('half', 'top');
    bottom.classList.add('half', 'bottom');
    task.classList.add('cut');
    task.append(top, bottom);
    slash.remove();
    await wait(570);

    // c) the gap closes
    knife.remove();
    task.style.height = task.offsetHeight + 'px';
    void task.offsetHeight;
    task.classList.add('gone');
    await wait(300);
}

document.querySelectorAll('.delete-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
        if (reduceMotion) return;                              // no animation: normal delete
        e.preventDefault();
        const task = form.closest('.task');
        if (task.classList.contains('slicing')) return;
        form.closest('.more').classList.remove('open');

        const request = fetch(form.action, { method: 'POST', body: new FormData(form) });
        sliceTask(task)
            .then(() => request)
            .then((res) => {
                if (!res.ok) throw new Error('Delete failed');
                const list = task.parentElement;
                task.remove();
                // refresh counts and empty state (on the month calendar: also the chips in the grid)
                if (!list.querySelector('.task') || document.querySelector('.month-grid')) location.reload();
            })
            .catch(() => location.reload());
    });
});

// 8. Time picker: clock popover for the start time + duration chips.
//    The form keeps two hidden inputs (due_time, end_time) that always hold "HH:MM" (24-hour) or "".
const MAX_END = 23 * 60 + 55;                                   // 11:55 PM: a task can't run past midnight
const CHIP_MINS = [15, 30, 45, 60, 90, 120];
const pad2 = (n) => String(n).padStart(2, '0');
const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; };
const toHHMM = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const fmt12 = (min) => `${Math.floor(min / 60) % 12 || 12}:${pad2(min % 60)} ${min >= 720 ? 'PM' : 'AM'}`;
const fmtDur = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h} hr ${m} min` : `${h} hr`) : `${m} min`;
};
const nowRounded = () => {
    const d = new Date();
    return Math.min(Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5, MAX_END);   // next 5 minutes
};

const tpRead = (tp) => ({
    start: toMin(tp.querySelector('[data-start]').value),
    end: toMin(tp.querySelector('[data-end]').value),
});
function tpSave(tp, start, end) {
    tp.querySelector('[data-start]').value = start == null ? '' : toHHMM(start);
    tp.querySelector('[data-end]').value = end == null ? '' : toHHMM(end);
    renderTP(tp);
}

// Show the current values: field text, which chip is selected, the result line, the note
function renderTP(tp) {
    const { start, end } = tpRead(tp);
    const field = tp.querySelector('.tp-field');
    field.querySelector('.tp-text').textContent = start == null ? 'Add a start time' : fmt12(start);
    field.classList.toggle('tp-empty', start == null);
    tp.querySelector('.tp-dur').hidden = start == null;

    let selected = null;
    if (start != null && end != null) {
        const asked = +tp.dataset.dur || 0;
        if (CHIP_MINS.includes(end - start)) selected = String(end - start);
        else if (asked && Math.min(start + asked, MAX_END) === end) selected = String(asked);   // chip was capped at 11:55 PM
        else selected = 'custom';
    }
    tp.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.min === selected)));

    tp.querySelector('.tp-result').textContent =
        start != null && end != null ? `${fmt12(start)} – ${fmt12(end)} (${fmtDur(end - start)})` : '';
    const note = tp.querySelector('.tp-note');
    note.textContent = tp.dataset.note || '';
    note.hidden = !tp.dataset.note;
}

// end = start + duration, capped at 11:55 PM
function applyDuration(tp, start, dur) {
    let end = start + dur, note = '';
    if (end > MAX_END) { end = MAX_END; note = 'Capped at 11:55 PM: tasks can’t run past midnight.'; }
    if (end <= start) { end = null; note = 'No time left before midnight for a duration.'; }
    tp.dataset.dur = dur;
    tp.dataset.note = note;
    tpSave(tp, start, end);
}

// New start time: keep the same duration if one was chosen, otherwise keep a custom end that is still later
function setStart(tp, start) {
    const { start: old, end } = tpRead(tp);
    const dur = tp.dataset.dur ? +tp.dataset.dur
        : (old != null && end != null && CHIP_MINS.includes(end - old) ? end - old : 0);
    if (dur) return applyDuration(tp, start, dur);
    tp.dataset.note = '';
    tpSave(tp, start, end != null && end > start ? end : null);
}

// ----- the popover (one shared element, moved to whichever field opened it) -----
const pop = { el: null, tp: null, field: 'start', mode: 'hour', h: 12, m: 0, pm: false, drag: false, trigger: null };
const popOpen = () => pop.el && !pop.el.hidden;

function buildPop() {
    if (pop.el) return;
    pop.el = document.createElement('div');
    pop.el.className = 'tp-pop';
    pop.el.hidden = true;
    pop.el.setAttribute('role', 'dialog');
    pop.el.setAttribute('aria-label', 'Pick a time');
    pop.el.innerHTML = `
        <div class="tp-title"></div>
        <div class="tp-presets">
            <button type="button" class="chip" data-preset="540">Morning 9:00</button>
            <button type="button" class="chip" data-preset="840">Afternoon 2:00</button>
            <button type="button" class="chip" data-preset="1080">Evening 6:00</button>
            <button type="button" class="chip" data-preset="now">Now</button>
        </div>
        <div class="tp-time">
            <button type="button" class="tp-seg" data-mode="hour" aria-label="Hours"></button><b>:</b>
            <button type="button" class="tp-seg" data-mode="min" aria-label="Minutes"></button>
            <div class="tp-ampm">
                <button type="button" data-ampm="AM">AM</button>
                <button type="button" data-ampm="PM">PM</button>
            </div>
        </div>
        <div class="tp-dial" tabindex="0" role="slider" aria-label="Hours"></div>
        <p class="tp-error" role="alert" hidden></p>
        <div class="tp-actions">
            <button type="button" class="btn ghost" data-clear>Clear</button>
            <button type="button" class="btn" data-done>Done</button>
        </div>`;
    document.body.append(pop.el);
    const dial = pop.el.querySelector('.tp-dial');

    // touch / mouse: press or drag on the dial; letting go on the hour dial moves on to minutes
    const pick = (e) => {
        const r = dial.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const idx = Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 30) % 12;
        if (pop.mode === 'hour') pop.h = idx || 12; else pop.m = idx * 5;
        drawPop();
    };
    dial.addEventListener('pointerdown', (e) => { pop.drag = true; dial.setPointerCapture(e.pointerId); pick(e); });
    dial.addEventListener('pointermove', (e) => { if (pop.drag) pick(e); });
    dial.addEventListener('pointerup', () => { if (!pop.drag) return; pop.drag = false; if (pop.mode === 'hour') setPopMode('min'); });
    dial.addEventListener('pointercancel', () => { pop.drag = false; });

    // keyboard: arrows turn the hand, Enter confirms the hour (then the minutes)
    dial.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (dir) {
            e.preventDefault();
            if (pop.mode === 'hour') pop.h = ((pop.h - 1 + dir + 12) % 12) + 1;
            else pop.m = dir > 0 ? ((Math.floor(pop.m / 5) + 1) * 5) % 60 : ((Math.ceil(pop.m / 5) - 1 + 12) * 5) % 60;
            drawPop();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (pop.mode === 'hour') setPopMode('min'); else finishPop();
        }
    });

    pop.el.addEventListener('click', (e) => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.mode) setPopMode(t.dataset.mode);
        else if (t.dataset.ampm) { pop.pm = t.dataset.ampm === 'PM'; drawPop(); }
        else if (t.dataset.preset) { setStart(pop.tp, t.dataset.preset === 'now' ? nowRounded() : +t.dataset.preset); closePop(); }
        else if (t.hasAttribute('data-clear')) clearPop();
        else if (t.hasAttribute('data-done')) finishPop();
    });
    // Tab stays inside the popover while it is open
    pop.el.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const items = [...pop.el.querySelectorAll('button, .tp-dial')].filter((n) => n.offsetParent);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
}

function setPopMode(mode) { pop.mode = mode; drawPop(); }

// Draw the numbers, the hand and the header for the current hour / minute / AM-PM
function drawPop() {
    const el = pop.el, hour = pop.mode === 'hour';
    const at = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [120 + r * Math.cos(a), 120 + r * Math.sin(a)]; };
    const deg = hour ? (pop.h % 12) * 30 : pop.m * 6;
    const [hx, hy] = at(deg, 92);
    const selIdx = hour ? pop.h % 12 : (pop.m % 5 ? -1 : pop.m / 5);
    let nums = '';
    for (let i = 0; i < 12; i++) {
        const [x, y] = at(i * 30, 92);
        nums += `<text class="tp-num${i === selIdx ? ' sel' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${hour ? (i || 12) : pad2(i * 5)}</text>`;
    }
    const dial = el.querySelector('.tp-dial');
    dial.innerHTML = `<svg viewBox="0 0 240 240" aria-hidden="true">
        <circle class="tp-face" cx="120" cy="120" r="116"/>
        <line class="tp-hand" x1="120" y1="120" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}"/>
        <circle class="tp-knob" cx="120" cy="120" r="4"/>
        <circle class="tp-knob" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="19"/>${nums}</svg>`;
    dial.setAttribute('aria-label', hour ? 'Hours' : 'Minutes');
    dial.setAttribute('aria-valuetext', `${pop.h}:${pad2(pop.m)} ${pop.pm ? 'PM' : 'AM'}`);
    el.querySelector('[data-mode=hour]').textContent = pop.h;
    el.querySelector('[data-mode=min]').textContent = pad2(pop.m);
    el.querySelector('[data-mode=hour]').classList.toggle('on', hour);
    el.querySelector('[data-mode=min]').classList.toggle('on', !hour);
    el.querySelectorAll('[data-ampm]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.ampm === 'PM') === pop.pm)));
    el.querySelector('.tp-error').hidden = true;
}

function placePop() {
    const w = pop.el.offsetWidth, h = pop.el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (vw < 560) {                                             // phone: centre it
        left = (vw - w) / 2; top = Math.max(8, (vh - h) / 2);
    } else {                                                    // desktop: under the field, or above if no room
        const r = pop.trigger.getBoundingClientRect();
        left = Math.min(Math.max(8, r.left), vw - w - 8);
        top = r.bottom + 8;
        if (top + h > vh - 8) top = r.top - h - 8;
        top = Math.max(8, Math.min(top, vh - h - 8));
    }
    pop.el.style.left = left + 'px';
    pop.el.style.top = top + 'px';
}

function openPop(tp, field) {
    if (popOpen() && pop.tp === tp && pop.field === field) return closePop();
    buildPop();
    const { start, end } = tpRead(tp);
    pop.tp = tp; pop.field = field; pop.mode = 'hour';
    pop.trigger = field === 'start' ? tp.querySelector('.tp-field') : tp.querySelector('[data-min=custom]');
    const base = (field === 'start' ? start : end) ?? (field === 'start' ? nowRounded() : Math.min(start + 60, MAX_END));
    pop.pm = base >= 720; pop.h = Math.floor(base / 60) % 12 || 12; pop.m = base % 60;
    pop.el.querySelector('.tp-title').textContent = field === 'start' ? 'Start time' : 'End time';
    pop.el.querySelector('.tp-presets').hidden = field !== 'start';
    pop.el.hidden = false;
    drawPop();
    placePop();
    pop.el.querySelector('.tp-dial').focus();
}

function closePop(refocus = true) {
    if (!popOpen()) return;
    pop.el.hidden = true;
    if (refocus && pop.trigger) pop.trigger.focus();
}

function finishPop() {
    const min = ((pop.h % 12) + (pop.pm ? 12 : 0)) * 60 + pop.m;
    if (pop.field === 'start') {
        setStart(pop.tp, min);
    } else {
        const { start } = tpRead(pop.tp);
        if (min <= start) {
            const err = pop.el.querySelector('.tp-error');
            err.textContent = 'The end time must be after the start time.';
            err.hidden = false;
            return;
        }
        delete pop.tp.dataset.dur;
        pop.tp.dataset.note = '';
        tpSave(pop.tp, start, min);
    }
    closePop();
}

function clearPop() {
    const { start } = tpRead(pop.tp);
    delete pop.tp.dataset.dur;
    pop.tp.dataset.note = '';
    if (pop.field === 'start') tpSave(pop.tp, null, null);      // no start time means no end time either
    else tpSave(pop.tp, start, null);
    closePop();
}

// Open the popover from the field, or from a duration chip
document.addEventListener('click', (e) => {
    const field = e.target.closest('.tp-field');
    if (field) return openPop(field.closest('.tp'), 'start');

    const chip = e.target.closest('.tp .chip');
    if (!chip) return;
    const tp = chip.closest('.tp'), { start } = tpRead(tp);
    if (start == null) return;
    if (chip.dataset.min === 'custom') return openPop(tp, 'end');
    if (chip.getAttribute('aria-pressed') === 'true') {         // press the chosen chip again to remove the end time
        delete tp.dataset.dur;
        tp.dataset.note = '';
        return tpSave(tp, start, null);
    }
    applyDuration(tp, start, +chip.dataset.min);
});

// Click outside closes it; Esc closes only the popover (not the add/edit dialog behind it)
document.addEventListener('pointerdown', (e) => {
    if (!popOpen() || pop.el.contains(e.target) || e.target.closest('.tp-field, .tp [data-min=custom]')) return;
    closePop(false);
}, true);
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popOpen()) { e.stopPropagation(); closePop(); }
}, true);
window.addEventListener('resize', () => { if (popOpen()) placePop(); });
window.addEventListener('scroll', () => { if (popOpen()) placePop(); }, true);

document.querySelectorAll('.tp').forEach(renderTP);

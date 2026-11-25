import calendar as pycalendar      # Python's calendar module ("pycalendar" because our view is also called calendar)
import re
from datetime import date, time, timedelta

from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.models import User
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db.models import (BooleanField, Case, CharField, Count, Exists, F, OuterRef, Q,
                              StringAgg, Value, When)
from django.db.models.functions import Cast
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import TODOO, Category, TaskCompletion

PRESET_COLORS = ['#7c8cf8', '#f2d94e', '#5fd3a8', '#f07fd8', '#ff8a65', '#4fc3f7',
                 '#b388ff', '#ff6b81', '#9ccc65', '#ffb74d', '#4db6ac', '#90a4ae']
HEX_RE = re.compile(r'^#[0-9a-f]{6}$')
DEFAULT_CATEGORY = {'name': 'General', 'color': '#7c8cf8'}
VIEWS = {'today': 'Today', 'scheduled': 'Scheduled', 'all': 'All', 'overdue': 'Overdue'}


# ---------- small helpers ----------

def parse_priority(value):
    """Turn the form value into 1, 2 or 3. Anything else becomes 2 (Medium)."""
    try:
        value = int(value)
    except (TypeError, ValueError):
        return 2
    return value if value in (1, 2, 3) else 2


def parse_date(value):
    try:
        return date.fromisoformat(value)       # '2026-11-25' -> date
    except (TypeError, ValueError):
        return None


def parse_time(value):
    try:
        return time.fromisoformat(value)       # '16:50' -> time
    except (TypeError, ValueError):
        return None


def user_categories(user):
    """Every task needs a category, so make sure the user always has at least one."""
    if not Category.objects.filter(user=user).exists():
        Category.objects.create(user=user, **DEFAULT_CATEGORY)
    return Category.objects.filter(user=user).order_by('id')


def on_day(queryset, day):
    """Tasks that show up on `day`:
    - one-day task            -> its date
    - start + end date        -> every day from start to end (inclusive)
    - repeat every day        -> every day from its start, until its end (or forever)"""
    single = Q(repeat_daily=False, end_date__isnull=True, due_date=day)
    span = Q(repeat_daily=False, due_date__lte=day, end_date__gte=day)
    repeating = Q(repeat_daily=True, due_date__lte=day) & (Q(end_date__isnull=True) | Q(end_date__gte=day))
    return queryset.filter(single | span | repeating)


def overdue_tasks(queryset, today):
    """Not done, and the LAST day (end date, or the date if there is no end) has passed.
    Repeating tasks are never overdue."""
    return queryset.filter(repeat_daily=False, done=False).filter(
        Q(end_date__isnull=True, due_date__lt=today) | Q(end_date__lt=today))


def with_done(queryset, day):
    """Adds `shown_done`: is the task done on `day`?
    A repeating task is done only if it was ticked on that exact day; others use `done`."""
    ticked = TaskCompletion.objects.filter(task=OuterRef('pk'), date=day)
    return queryset.annotate(shown_done=Case(
        When(repeat_daily=True, then=Exists(ticked)),
        default=F('done'),
        output_field=BooleanField(),
    ))


def sorted_tasks(queryset, day):
    """Unfinished first, then High priority, then the soonest due."""
    return with_done(queryset, day).select_related('category').order_by(
        'shown_done', 'priority',
        F('due_date').asc(nulls_last=True), F('due_time').asc(nulls_last=True), '-date')


def with_counts(categories, today):
    """Adds `total` and `completed` to each category (repeating tasks count as done if ticked today)."""
    return categories.annotate(
        total=Count('todoo', distinct=True),
        completed=Count('todoo', distinct=True, filter=(
            Q(todoo__repeat_daily=False, todoo__done=True) |
            Q(todoo__repeat_daily=True, todoo__taskcompletion__date=today))),
    )


def date_context():
    today = timezone.localdate()
    return {'today': today, 'tomorrow': today + timedelta(days=1), 'yesterday': today - timedelta(days=1)}


def read_times(request):
    """Start and end time from the form. An end before the start is dropped."""
    start = parse_time(request.POST.get('due_time'))
    end = parse_time(request.POST.get('end_time'))
    if start is None or (end is not None and end <= start):
        end = None
    return start, end


def read_dates(request):
    """Start date, end date and the repeat switch from the form.
    Returns (start, end, repeat, warning). A repeating task (or one with an end date)
    starts today if no start date was given. An end date before the start is ignored."""
    start = parse_date(request.POST.get('due_date'))
    end = parse_date(request.POST.get('end_date'))
    repeat = request.POST.get('repeat_daily') == '1'
    warning = None
    if start is None and (repeat or end is not None):
        start = timezone.localdate()
    if end is not None and end < start:
        end = None
        warning = 'The end date is before the start date, so it was ignored.'
    return start, end, repeat, warning


def week_of(day):
    monday = day - timedelta(days=day.weekday())
    return [monday + timedelta(days=i) for i in range(7)]


def time_groups(tasks):
    """Split a day's tasks into Morning / Afternoon / Evening / Anytime."""
    groups = [
        {'label': 'Morning', 'icon': 'sunrise', 'tasks': []},
        {'label': 'Afternoon', 'icon': 'sun', 'tasks': []},
        {'label': 'Evening', 'icon': 'moon', 'tasks': []},
        {'label': 'Anytime', 'icon': 'clock', 'tasks': []},
    ]
    for t in tasks:
        if t.due_time is None:
            groups[3]['tasks'].append(t)
        elif t.due_time.hour < 12:
            groups[0]['tasks'].append(t)
        elif t.due_time.hour < 17:
            groups[1]['tasks'].append(t)
        else:
            groups[2]['tasks'].append(t)
    return [g for g in groups if g['tasks']]


MONTH_RE = re.compile(r'^(\d{4})-(\d{1,2})$')
WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def parse_month(value):
    """'2026-11' -> date(2026, 11, 1). Anything else (or a silly year) -> None."""
    match = MONTH_RE.match(value or '')
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    if not (1900 <= year <= 2200 and 1 <= month <= 12):
        return None
    return date(year, month, 1)


def shift_month(first_of_month, step):
    """The 1st of the previous (step -1) or next (step +1) month. Works across years (Dec -> Jan)."""
    if step < 0:
        return (first_of_month - timedelta(days=1)).replace(day=1)
    return (first_of_month + timedelta(days=32)).replace(day=1)


def tasks_by_day(user, first, last):
    """ONE database query for every task that happens between `first` and `last`,
    expanded in Python into {date: [tasks]}: one-day, start -> end and repeat-every-day tasks
    each land on every day they occur. The same query also brings back the days each task was
    ticked (text like '2026-11-25,2026-11-26'), so per-day done status needs no extra query."""
    single = Q(repeat_daily=False, end_date__isnull=True, due_date__range=(first, last))
    span = Q(repeat_daily=False, due_date__lte=last, end_date__gte=first)
    repeating = Q(repeat_daily=True, due_date__lte=last) & (Q(end_date__isnull=True) | Q(end_date__gte=first))
    tasks = (TODOO.objects.filter(user=user).filter(single | span | repeating)
             .select_related('category')
             .annotate(ticked=StringAgg(Cast('taskcompletion__date', CharField()), Value(','),
                                        filter=Q(taskcompletion__date__range=(first, last))))
             .order_by(F('due_time').asc(nulls_last=True), 'priority', 'srno'))

    by_day = {}
    for t in tasks:
        t.ticked_days = set(t.ticked.split(',')) if t.ticked else set()
        last_day = t.end_date or (None if t.repeat_daily else t.due_date)     # None = repeats forever
        day = max(t.due_date, first)
        stop = last if last_day is None else min(last_day, last)
        while day <= stop:
            by_day.setdefault(day, []).append(t)
            day += timedelta(days=1)
    return by_day


def done_on(task, day):
    """Is the task done on this day? Repeating: only if ticked that day. Others: their own done flag."""
    return day.isoformat() in task.ticked_days if task.repeat_daily else task.done


def safe_next(request, default='todo'):
    """Only redirect back to pages on our own site."""
    nxt = request.POST.get('next', '')
    return nxt if nxt.startswith('/') and not nxt.startswith('//') else default


# ---------- accounts ----------

def signup(request):
    if request.method == 'POST':
        fnm = request.POST.get('fnm', '').strip()
        emailid = request.POST.get('email', '').strip().lower()
        pwd = request.POST.get('pwd')
        if User.objects.filter(username__iexact=fnm).exists():
            messages.error(request, 'That username is taken.')
        elif User.objects.filter(email__iexact=emailid).exists():
            messages.error(request, 'That email already has an account.')
        else:
            user = User.objects.create_user(fnm, emailid, pwd)
            Category.objects.create(user=user, **DEFAULT_CATEGORY)
            messages.success(request, 'Account created. Log in to start.')
            return redirect('login')
        # show the form again with what they typed
        return render(request, 'signup.html', {'fnm': fnm, 'email': emailid})
    return render(request, 'signup.html')


def loginn(request):
    if request.method == 'POST':
        user = authenticate(request,
                            username=request.POST.get('fnm'),
                            password=request.POST.get('pwd'))
        if user is not None:
            login(request, user)
            request.session['show_welcome'] = True     # show the popup once
            return redirect('todo')
        messages.error(request, 'Wrong username or password.')
        return redirect('login')
    return render(request, 'login.html')


def signout(request):
    logout(request)
    return redirect('login')


# ---------- tasks ----------

@login_required(login_url='login')
def todo(request):
    categories = user_categories(request.user)

    if request.method == 'POST':
        title = request.POST.get('title', '').strip()
        category = categories.filter(id=request.POST.get('category') or 0).first()
        if category is None:
            messages.error(request, 'Pick a category.')
        elif title:
            start, end = read_times(request)
            start_date, end_date, repeat, warning = read_dates(request)
            TODOO.objects.create(
                title=title,
                user=request.user,
                category=category,
                priority=parse_priority(request.POST.get('priority')),
                due_date=start_date,
                end_date=end_date,
                repeat_daily=repeat,
                due_time=start,
                end_time=end,
            )
            if warning:
                messages.warning(request, warning)
        return redirect(safe_next(request))

    dates = date_context()
    today = dates['today']
    mine = TODOO.objects.filter(user=request.user)
    buckets = {
        'today': on_day(mine, today),
        'scheduled': mine.filter(due_date__gt=today),
        'all': mine,
        'overdue': overdue_tasks(mine, today),
    }
    # "open" = not done today (a repeating task only counts as done on the day it was ticked)
    counts = {name: with_done(qs, today).filter(shown_done=False).count() for name, qs in buckets.items()}

    view = request.GET.get('view', 'today')
    if view not in VIEWS:
        view = 'today'
    q = request.GET.get('q', '').strip()
    tasks = mine.filter(title__icontains=q) if q else buckets[view]

    context = {
        **dates,
        'tasks': sorted_tasks(tasks, today),
        'view_day': today,
        'q': q,
        'show_dates': bool(q) or view != 'today',
        'view': view,
        'view_label': VIEWS[view],
        'counts': counts,
        'categories': with_counts(categories, today),
        'default_date': today,
        'show_welcome': request.session.pop('show_welcome', False),
    }
    return render(request, 'todo.html', context)


@login_required(login_url='login')
def calendar(request):
    """Month grid (the default) or the week strip (?view=week)."""
    if request.GET.get('view') == 'week':
        return calendar_week(request)
    return calendar_month(request)


def calendar_month(request):
    dates = date_context()
    today = dates['today']
    picked = parse_date(request.GET.get('day'))
    month = parse_month(request.GET.get('month')) or (picked or today).replace(day=1)
    weeks = pycalendar.Calendar(firstweekday=0).monthdatescalendar(month.year, month.month)
    first, last = weeks[0][0], weeks[-1][-1]        # the grid also shows a few days of the months around it

    # The selected day: ?day= if it is on the grid, else today (when viewing this month), else the 1st
    if picked and first <= picked <= last:
        selected = picked
    elif (today.year, today.month) == (month.year, month.month):
        selected = today
    else:
        selected = month

    by_day = tasks_by_day(request.user, first, last)    # the one query for the whole month

    grid = []
    for week in weeks:
        row = []
        for d in week:
            tasks = by_day.get(d, [])
            row.append({
                'date': d,
                'in_month': d.month == month.month,
                'is_today': d == today,
                'selected': d == selected,
                'total': len(tasks),
                'chips': [{'id': t.srno, 'title': t.title, 'color': t.category.color,
                           'repeat': t.repeat_daily, 'done': done_on(t, d)} for t in tasks[:3]],
                'more': max(len(tasks) - 3, 0),
            })
        grid.append(row)

    day_tasks = by_day.get(selected, [])
    for t in day_tasks:
        t.shown_done = done_on(t, selected)             # what each row's checkbox shows for this day

    return render(request, 'calendar.html', {
        **dates,
        'mode': 'month',
        'month': month,
        'prev_month': shift_month(month, -1),
        'next_month': shift_month(month, 1),
        'weekdays': WEEKDAYS,
        'grid': grid,
        'day': selected,
        'view_day': selected,
        'day_total': len(day_tasks),
        'groups': time_groups(day_tasks),
        'categories': user_categories(request.user),
        'default_date': selected,                      # the + button pre-fills the selected day
    })


def calendar_week(request):
    dates = date_context()
    day = parse_date(request.GET.get('day')) or dates['today']
    week = week_of(day)
    mine = TODOO.objects.filter(user=request.user)
    busy = {d for d in week if on_day(mine, d).exists()}     # multi-day and repeating tasks light up every matching day

    tasks = (with_done(on_day(mine, day), day).select_related('category')
             .order_by(F('due_time').asc(nulls_last=True), 'priority'))

    return render(request, 'calendar.html', {
        **dates,
        'mode': 'week',
        'day': day,
        'view_day': day,
        'week': [{'date': d, 'busy': d in busy} for d in week],
        'prev_week': week[0] - timedelta(days=7),
        'next_week': week[0] + timedelta(days=7),
        'groups': time_groups(tasks),
        'categories': user_categories(request.user),
        'default_date': day,
    })


@login_required(login_url='login')
@require_POST
def toggle_done(request, srno):
    task = get_object_or_404(TODOO, srno=srno, user=request.user)
    if task.repeat_daily:
        # Repeating: only the day being viewed is ticked. Ticking again un-ticks that day.
        day = parse_date(request.POST.get('date')) or timezone.localdate()
        tick, created = TaskCompletion.objects.get_or_create(task=task, date=day)
        if not created:
            tick.delete()
        done = created
    else:
        task.done = not task.done
        task.save(update_fields=['done'])
        done = task.done
    if request.headers.get('X-Requested-With') == 'fetch':
        return JsonResponse({'done': done})               # JavaScript asked: answer with data
    return redirect(safe_next(request))


@login_required(login_url='login')
def edit_todo(request, srno):
    obj = get_object_or_404(TODOO, srno=srno, user=request.user)   # only your own task
    categories = user_categories(request.user)

    if request.method == 'POST':
        obj.title = request.POST.get('title', '').strip() or obj.title
        obj.category = categories.filter(id=request.POST.get('category') or 0).first() or obj.category
        obj.priority = parse_priority(request.POST.get('priority'))
        obj.due_date, obj.end_date, obj.repeat_daily, warning = read_dates(request)
        obj.due_time, obj.end_time = read_times(request)
        obj.save()
        if warning:
            messages.warning(request, warning)
        return redirect('todo')

    return render(request, 'edit_todo.html', {'obj': obj, 'categories': categories})


@login_required(login_url='login')
@require_POST
def delete_todo(request, srno):
    get_object_or_404(TODOO, srno=srno, user=request.user).delete()
    return redirect(safe_next(request))


# ---------- lists (categories) ----------

@login_required(login_url='login')
def lists(request):
    categories = with_counts(user_categories(request.user), timezone.localdate())
    return render(request, 'lists.html', {'categories': categories})


@login_required(login_url='login')
def list_detail(request, pk):
    category = get_object_or_404(Category, pk=pk, user=request.user)
    dates = date_context()
    tasks = sorted_tasks(category.todoo_set.all(), dates['today'])
    return render(request, 'list_detail.html', {
        **dates,
        'view_day': dates['today'],
        'category': category,
        'tasks': tasks,
        'completed': tasks.filter(shown_done=True).count(),
    })


@login_required(login_url='login')
def settings_page(request):
    mine = user_categories(request.user)

    if request.method == 'POST':
        name = request.POST.get('name', '').strip()
        color = request.POST.get('color', '').lower()
        taken = mine.filter(color=color).first()
        if not name:
            messages.error(request, 'Give the category a name.')
        elif not HEX_RE.match(color):
            messages.error(request, 'Pick a valid colour.')
        elif taken:
            messages.error(request, f'That colour is already used by "{taken.name}".')
        elif mine.filter(name__iexact=name).exists():
            messages.error(request, f'You already have a category called "{name}".')
        else:
            Category.objects.create(name=name, color=color, user=request.user)   # no toast
        return redirect('settings')

    categories = mine.annotate(n=Count('todoo'))
    used = {c.color for c in categories}
    free = [c for c in PRESET_COLORS if c not in used]       # hide colours already taken
    return render(request, 'settings.html', {
        'categories': categories,
        'presets': free,
        'default_color': free[0] if free else '#ffffff',
    })


@login_required(login_url='login')
@require_POST
def delete_category(request, pk):
    category = get_object_or_404(Category, pk=pk, user=request.user)
    count = category.todoo_set.count()
    if count:
        messages.error(request, f'"{category.name}" still has {count} task{"s" if count != 1 else ""}. Move or delete them first.')
    elif Category.objects.filter(user=request.user).count() == 1:
        messages.error(request, 'You need at least one category.')
    else:
        category.delete()
    return redirect('settings')

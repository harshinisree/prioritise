from django.db import models
from django.contrib.auth.models import User


class Category(models.Model):
    name = models.CharField(max_length=30)
    color = models.CharField(max_length=7)      # hex colour, e.g. #ff5c8a
    user = models.ForeignKey(User, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            # one colour = one category (per user)
            models.UniqueConstraint(fields=['user', 'color'], name='one_category_per_colour'),
            models.UniqueConstraint(fields=['user', 'name'], name='unique_category_name'),
        ]

    def __str__(self):
        return self.name


class TODOO(models.Model):
    PRIORITY_CHOICES = [(1, 'High'), (2, 'Medium'), (3, 'Low')]

    srno = models.AutoField(primary_key=True)
    title = models.CharField(max_length=100)
    date = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    category = models.ForeignKey(Category, on_delete=models.RESTRICT)   # required now
    priority = models.IntegerField(choices=PRIORITY_CHOICES, default=2)
    due_date = models.DateField(null=True, blank=True)
    due_time = models.TimeField(null=True, blank=True)     # start time
    end_time = models.TimeField(null=True, blank=True)
    done = models.BooleanField(default=False)               # used by one-off and multi-day tasks
    end_date = models.DateField(null=True, blank=True)      # optional: makes it a multi-day task
    repeat_daily = models.BooleanField(default=False)       # "Repeat every day"

    def __str__(self):
        return self.title


class TaskCompletion(models.Model):
    """One row = "this repeating task was ticked on this day"."""
    task = models.ForeignKey(TODOO, on_delete=models.CASCADE)
    date = models.DateField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['task', 'date'], name='one_completion_per_task_per_day'),
        ]

    def __str__(self):
        return f'{self.task} on {self.date}'

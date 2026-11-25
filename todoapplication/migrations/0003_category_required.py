from django.db import migrations, models
import django.db.models.deletion

DEFAULT_NAME = 'General'
FALLBACK_COLOURS = ['#7c8cf8', '#14b8a6', '#eab308', '#ec4899', '#8b5cf6', '#64748b']


def give_every_task_a_category(apps, schema_editor):
    """Old tasks had no category. Put them in a 'General' category for their owner."""
    TODOO = apps.get_model('todoapplication', 'TODOO')
    Category = apps.get_model('todoapplication', 'Category')

    for task in TODOO.objects.filter(category__isnull=True):
        general = Category.objects.filter(user_id=task.user_id, name=DEFAULT_NAME).first()
        if general is None:
            used = set(Category.objects.filter(user_id=task.user_id).values_list('color', flat=True))
            colour = next((c for c in FALLBACK_COLOURS if c not in used), '#000001')
            general = Category.objects.create(user_id=task.user_id, name=DEFAULT_NAME, color=colour)
        task.category = general
        task.save()


class Migration(migrations.Migration):

    dependencies = [
        ('todoapplication', '0002_todoo_priority_alter_todoo_title_category_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='category',
            name='color',
            field=models.CharField(max_length=7),
        ),
        # 1. fill in the missing categories BEFORE making the field required
        migrations.RunPython(give_every_task_a_category, migrations.RunPython.noop),
        # 2. now every task has one, so the field can be required
        migrations.AlterField(
            model_name='todoo',
            name='category',
            field=models.ForeignKey(on_delete=django.db.models.deletion.RESTRICT, to='todoapplication.category'),
        ),
        # 3. one colour = one category, and no duplicate names
        migrations.AddConstraint(
            model_name='category',
            constraint=models.UniqueConstraint(fields=('user', 'color'), name='one_category_per_colour'),
        ),
        migrations.AddConstraint(
            model_name='category',
            constraint=models.UniqueConstraint(fields=('user', 'name'), name='unique_category_name'),
        ),
    ]

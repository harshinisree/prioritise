from django.contrib import admin
from django.urls import path
from todoapplication import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.signup, name='signup'),
    path('loginn/', views.loginn, name='login'),
    path('signout/', views.signout, name='signout'),
    path('todopage/', views.todo, name='todo'),
    path('calendar/', views.calendar, name='calendar'),
    path('toggle/<int:srno>', views.toggle_done, name='toggle_done'),
    path('edit_todo/<int:srno>', views.edit_todo, name='edit_todo'),
    path('delete_todo/<int:srno>', views.delete_todo, name='delete_todo'),
    path('lists/', views.lists, name='lists'),
    path('lists/<int:pk>/', views.list_detail, name='list_detail'),
    path('settings/', views.settings_page, name='settings'),
    path('delete_category/<int:pk>', views.delete_category, name='delete_category'),
]

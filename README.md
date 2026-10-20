# KaizenHub

Конвейер проектов для агентства. Один файл `index.html` + Supabase (вход и база) + Vercel (хостинг и `/api/sample`).

**Быстрый старт**
1. Supabase: выполнить `supabase/migrations/20261020000000_init.sql` в SQL Editor.
2. Vercel: импортировать этот репозиторий, добавить переменные `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
3. Supabase → Authentication → URL Configuration: указать адрес сайта с Vercel (Site URL и Redirect URLs `https://адрес/**`).

**Проверка:** `cd tests && npm install && npm test`

Подробные правила работы — в `CLAUDE.md`.

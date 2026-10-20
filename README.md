# KaizenHub — Конвейер проектов

Исходник артефакта: https://claude.ai/artifact/LiTnhzyaw2CXfPaYzZ96L5

- `index.html` — всё приложение в одном файле.
- Развёрнуто через GitHub Pages (Settings → Pages → Branch: `main`, папка `/`).

## Важно про данные
- В Claude (артефакт) данные хранятся в облаке аккаунта Claude.
- На GitHub Pages `window.claude` недоступен — приложение работает в локальном
  режиме и хранит данные в `localStorage` браузера (у каждого пользователя свои).

## Бэкап
Каждый коммит — снимок версии. Чтобы сохранить новую версию артефакта:
попросите Claude «обнови бэкап KaizenHub», затем:

    git add -A && git commit -m "Бэкап $(date +%F)" && git push

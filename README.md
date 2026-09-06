# QuestDay 2.1

Telegram Mini App для ежедневных RPG-квестов.

## Новое в 2.1
- Заметки на любую дату календаря.
- Индикатор 📝 на датах с заметками.
- Профиль героя: имя, возраст, рост, вес, пол и главная цель.
- Автоматический подбор игрового класса: Воин, Страж, Маг или Монах.
- Класс учитывает выбранную цель, текущие характеристики и базовые данные профиля.
- Профиль, заметки и прогресс синхронизируются вместе с существующим Redis/KV API.
- Старые данные совместимы: новые поля добавляются автоматически через `normalize()`.

## Vercel
Переменные окружения остаются прежними:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `TELEGRAM_BOT_TOKEN`

Структура проекта не изменилась: `index.html` и `api/profile.js`.

## QuestDay 2.6 — герой, Quest Score, награды и босс
- На странице «Герой» автоматически показывается мужская или женская модель выбранного класса из `assets/characters/`.
- Класс по-прежнему определяется автоматически по характеристикам и цели профиля.
- Добавлен Quest Score — отдельный показатель прогресса, не равный XP.
- Достижения теперь дают Quest Coins и некоторые открывают титулы.
- Добавлен еженедельный личный босс «Дракон Прокрастинации»: выполненные квесты наносят ему урон.
- За победу над боссом выдаются Quest Coins и титул.
- Экипировка, магазин и проверка выполнения квестов пока не добавлялись.


### QuestDay 2.6.1
Character sprites are embedded directly into the hero page as PNG data URLs, so the hero models render even if Vercel/GitHub static asset paths are misconfigured. The exact supplied 8 character files are retained in assets/characters/ as well.


## QuestDay 2.7.1 — Друзья и рейтинг
- Добавлен рейтинг среди друзей по Quest Score.
- Добавлены взаимные связи друзей через Telegram Mini App deep link `startapp=ref_<telegram_user_id>`.
- За нового друга, который впервые запускает QuestDay по приглашению, пригласивший получает +100 Quest Coins.
- Повторное открытие ссылки не начисляет награду повторно.
- В рейтинге показываются место, имя, класс, уровень, серия и Quest Score.
- Глобального рейтинга нет.
- Экипировка не добавлялась.


## 2.7.2
- Fixed global leaderboard using a Redis sorted-set index.
- Existing profiles are migrated into the leaderboard index on first leaderboard request if needed.
- Normal profile sync now updates the leaderboard automatically.


### Global rating
Every authenticated Mini App open registers the Telegram user in Redis set `questday:users`. The rating reads this directory and no longer depends on Redis SCAN. Players are shown after Quest Score becomes greater than 0.


## 2.7.4
Leaderboard diagnostics and robust Upstash env fallback.


## QuestDay 2.7.6
Leaderboard architecture simplified: Telegram /start registers users in Redis, Mini App profile sync updates progress, and the global rating reads the questday:users directory and profiles directly.

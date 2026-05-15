# Smart Contacts

Децентрализованный оффлайн-first менеджер контактов. На текущей фазе — браузерное PWA + desktop SPA, далее — Tauri.

![Скриншот Smart Contacts на десктопе](Screenshot.jpg)

## Интеграция с Google Contacts

Read-only синхронизация из Google People API в локальный SQLite. **Приложение принципиально не имеет write-capability** к Google — OAuth scope `contacts.readonly`, allowlist HTTP-методов и URL, write-surface проверяется в `pull-engine.no-write.test.ts`.

### Настройка

1. Cloud Console → включить People API; создать OAuth-клиента типа **Desktop app** (PKCE).
2. Settings → Google Contacts → ввести Client ID + Client Secret, сохранить.
3. **Connect** → системный браузер открывает consent-экран Google → дать scope `contacts.readonly` → loopback-порт возвращает auth-код.
4. **Sync now** → первый запуск тянет все контакты целиком; последующие — инкремент через `syncToken`.

Перед каждой записью в БД показывается Dry-Run модалка со списком inserts / updates / deletes / conflicts. Полевые конфликты ставятся в отдельную очередь на ручное разрешение; bulk-apply их никогда не трогает.

### Аватары

Байты аватаров **не качаются** во время bulk-sync — Google CDN троттлит любой IP при массовых параллельных запросах, а аутентифицированной точки для байт в People API нет. Поэтому фото подтягиваются лениво:

- В snapshot каждого контакта сохраняется `photoUrl`.
- При первом открытии контакта в правой панели запускается one-shot fetch на `=s400`, байты сохраняются в таблицу `avatars` (BLOB) и отрисовываются.
- В списке контактов кешированное фото заменяет инициалы сразу после сохранения, без отдельного refresh.
- Клик по аватарке (в detail-панели или в диалоге редактирования) открывает fullscreen-лайтбокс.

Защита от rate limit:

- React-debounce 300 ms — быстрый клик по списку не дёргает fetch на каждую строку.
- In-flight дедуп по `contactId` на уровне runtime.
- Глобальный 60-секундный circuit breaker после любого HTTP 429 — никакие другие lazy fetch не запустятся до его истечения.
- `maxRetries=0` на lazy-пути — одна попытка, без backoff-спама по тротлящему CDN.

### Метки списка и фильтр

- Четырёхцветная буква «G» рядом с именем означает, что контакт импортирован из Google.
- Маленькая иконка картинки рядом с «G» означает, что **в Google есть фото у этого контакта** (независимо от того, скачаны ли байты локально).
- В Sort-баре есть toggle **«С фото»**; включён — список ограничен контактами с фото. Параллельно в FilterChipsBar появляется чип с «×» для сброса.

### Действия в Settings → Google Contacts

- **Sync now** — инкрементальный sync через `syncToken`; fallback на полный fetch, если токен истёк или его нет.
- **Open in Google** — открывает contacts.google.com в системном браузере.
- **Remove duplicates** — однократная очистка дубликатов после цикла «Disconnect (с сохранением) → Reconnect → Sync». Удаляет локальный контакт, у которого `google_resource_name` IS NULL и есть «двойник» с тем же `display_name`, привязанный к Google.
- **Disconnect** — двухшаговый: оставить импортированные контакты как чисто локальные (стирает `google_resource_name`) **или** удалить все Google-привязанные строки.

### Tauri SQL workaround

`@tauri-apps/plugin-sql` v2.4 не имеет настоящего BLOB-биндинга для `JsonValue::Array` — Uint8Array, проходя через JSON IPC Tauri, оказывается сериализован как текст и сохраняется по type-affinity в BLOB-колонку (plugins-workspace#105 всё ещё открыт). `tauri-sql-backend.ts` переписывает каждый Uint8Array-параметр во встроенный hex-литерал `x'FFD8FF...'` ДО передачи в plugin-sql; SQLite распарсит его как настоящий BLOB. Полное обоснование — в шапке файла.

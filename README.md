# Seal English 🦭📘

Сайт і платформа онлайн-школи англійської: маркетинговий лендинг, особисті кабінети (учень / викладач / менеджер / адміністратор), розклад з автоматичним Google Meet, домашні завдання, матеріали, CRM заявок на пробний урок і Telegram-бот.

## Архітектура

| Шар | Технології |
| --- | --- |
| Фронтенд | Next.js 16 (App Router, **static export** → `out/`), React 19, Tailwind CSS 4, Motion, Radix UI, TanStack Query |
| Хостинг | Wasmer Edge — роздає статичний `out/` (автоматичне визначення Next.js) |
| Дані й авторизація | Supabase: Postgres + RLS, Auth, Storage, Realtime, Vault, pg_cron, pg_net |
| Серверна логіка | Supabase Edge Functions (Deno) у `supabase/functions` |
| Маскот | SVG-риґ `src/components/mascot/Seal.tsx`, геометрія генерується з референсу скриптом `design/mascot/build_rig.py` |

### Edge Functions

| Функція | Що робить |
| --- | --- |
| `lead` | Приймає заявку з сайту (валідація, honeypot, rate limit) |
| `telegram` | Webhook бота: запис на пробний, картки заявок зі статусами для менеджерів, розклад, ДЗ, прив'язка акаунта |
| `notify` | Доставляє сповіщення в Telegram (викликається з БД через pg_net) |
| `schedule` | Створення уроків і серій з Google Meet, перенесення, скасування |
| `admin` | Акаунти користувачів, перетворення заявки на учня, налаштування інтеграцій |
| `google-oauth` | Підключення акаунта Google школи (Calendar + Meet) |

Сповіщення працюють за схемою outbox: тригери в БД пишуть у `notifications`, звідти pg_net миттєво викликає `notify`. Нагадування за годину до уроку й за добу до дедлайну ДЗ створює `pg_cron` кожні 5 хвилин.

Секрети інтеграцій (токен бота, Google OAuth) адміністратор вводить у кабінеті (**Налаштування → Інтеграції**). Вони зберігаються зашифровано у Supabase Vault і недоступні з браузера.

## Перший запуск — чекліст

1. **Supabase → Authentication → URL Configuration**
   - Site URL: адреса сайту (`https://www.sealenglish.school`)
   - Redirect URLs: `https://<ваш-домен>/**` і `http://localhost:3000/**`
2. Відкрийте **`/setup`** і створіть акаунт адміністратора. Сторінка працює лише доки в школі немає жодного адміна.
3. Після цього в **Authentication → Sign In / Providers → Email** вимкніть «Allow new users to sign up»: акаунти створює менеджер у кабінеті.
4. **Кабінет → Інтеграції**:
   - вкажіть адресу сайту;
   - Telegram: створіть бота в @BotFather і вставте токен. Webhook, команди й опис налаштуються автоматично;
   - Google: створіть OAuth-клієнт (Web) у Google Cloud, додайте показаний redirect URI, збережіть Client ID і secret, натисніть «Підключити акаунт Google». Застосунок у Google Cloud переведіть у статус *In production*.
5. **Налаштування → Підключити Telegram**: кожен менеджер підключає свій Telegram, щоб отримувати заявки.
6. Перегляньте контент у `src/content/site.ts`: ціни, контакти, реквізити. Юридичні сторінки лежать у `src/app/privacy` і `src/app/offer`.

## Розробка

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # статичний експорт у out/
npm run lint
```

Публічні змінні — у `.env.production` / `.env.development` (URL проєкту та publishable key Supabase, адреса сайту).

### Бренд і маскот

- `python design/mascot/build_rig.py` — перегенерувати геометрію риґу з `design/mascot/seal-reference.png`
- `python design/mascot/preview_rig.py` — порівняння риґу з оригіналом (`design/mascot/out/compare.png`)
- `python design/brand/build_brand.py` — логотипи, іконки, фавікони, OG-зображення в `public/`

### Деплой

- **Сайт**: push у `main` → Wasmer збирає Next.js і публікує `out/`.
- **Edge Functions**: GitHub Action `.github/workflows/supabase-functions.yml` (потрібен секрет репозиторію `SUPABASE_ACCESS_TOKEN`) або `supabase functions deploy`.
- **Міграції БД**: `supabase/migrations` (уже застосовані до проєкту `seal-english`).

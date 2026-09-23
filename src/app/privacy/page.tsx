import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { SITE } from "@/content/site";

export const metadata: Metadata = { title: "Політика конфіденційності" };

// TODO(owner): review with a lawyer before launch.
export default function PrivacyPage() {
  return (
    <LegalPage title="Політика конфіденційності" updated="23 вересня 2026">
      <p>
        Ця політика пояснює, які персональні дані збирає онлайн-школа {SITE.name} ({SITE.legal.owner}), навіщо і як ми їх захищаємо.
      </p>
      <h2>Які дані ми збираємо</h2>
      <ul>
        <li>Дані із заявки на пробний урок: ім&apos;я, вік, телефон, email, Telegram-нікнейм, мета навчання, коментар.</li>
        <li>Дані облікового запису в кабінеті: ім&apos;я, email, телефон, фото профілю, розклад, домашні завдання, оцінки.</li>
        <li>Технічні дані: мітки UTM для аналізу реклами, IP-адреса для захисту від спаму.</li>
      </ul>
      <h2>Навіщо</h2>
      <ul>
        <li>Щоб зв&apos;язатися з вами та організувати пробний урок.</li>
        <li>Щоб надавати освітні послуги: розклад, уроки в Google Meet, домашні завдання, сповіщення в Telegram.</li>
        <li>Щоб покращувати сервіс і захищати його від зловживань.</li>
      </ul>
      <h2>Кому передаються дані</h2>
      <p>
        Дані зберігаються в Supabase (ЄС) і обробляються лише персоналом школи. Для уроків використовуються Google Calendar/Meet, для
        сповіщень — Telegram. Ми не продаємо й не передаємо дані третім особам для реклами.
      </p>
      <h2>Дані Google (Google Calendar / Meet)</h2>
      <p>
        Адміністратор школи підключає до платформи один службовий акаунт Google школи з доступом <code>calendar.events</code>. Ми
        використовуємо цей доступ лише для того, щоб створювати, змінювати й скасовувати події календаря з посиланнями Google Meet для
        уроків і додавати до них учасників уроку. Ми не читаємо інші події, пошту, контакти чи файли, не передаємо дані Google третім особам,
        не використовуємо їх для реклами чи навчання моделей ШІ. Токен доступу зберігається в зашифрованому сховищі й видаляється при
        від&apos;єднанні акаунта в налаштуваннях кабінету або на{" "}
        <a className="font-semibold text-seal-700" href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
      </p>
      <p>
        {SITE.name}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="font-semibold text-seal-700" href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We use the <code>calendar.events</code> scope only to create, update and cancel lesson
        events with Google Meet links in the school&apos;s own calendar and invite lesson participants. Google user data is never sold,
        shared with third parties, used for advertising, or used to train AI models.
      </p>
      <h2>Дані дітей</h2>
      <p>Заявку та акаунт для учня до 14 років оформлює один із батьків або законний представник.</p>
      <h2>Ваші права</h2>
      <p>
        Ви можете запросити доступ до своїх даних, їх виправлення або видалення, написавши на <a className="font-semibold text-seal-700" href={`mailto:${SITE.email}`}>{SITE.email}</a>.
      </p>
    </LegalPage>
  );
}

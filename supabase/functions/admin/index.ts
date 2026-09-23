// Staff operations: user accounts, lead conversion, integrations (Telegram / Google).
import {
  admin, functionsUrl, getSecret, getSetting, handle, HttpError, isStaff, json, randomToken, readJson, requireUser,
  setSecret, setSetting, siteUrl, type Profile, type Role,
} from "../_shared/core.ts";
import { googleConfigured } from "../_shared/google.ts";
import { sendMessage, tg } from "../_shared/telegram.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ROLES: Role[] = ["student", "teacher", "manager", "admin"];

function genPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "Seal-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function assertRoleAllowed(me: Profile, role: Role) {
  if (!ROLES.includes(role)) throw new HttpError(422, "Невідома роль");
  if (role === "admin" && me.role !== "admin") throw new HttpError(403, "Призначати адміністраторів може лише адміністратор");
}

async function createAccount(me: Profile, input: Any) {
  const email = String(input.email ?? "").trim().toLowerCase();
  const fullName = String(input.full_name ?? "").trim();
  const role = (input.role ?? "student") as Role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "Вкажіть коректний email");
  if (fullName.length < 2) throw new HttpError(422, "Вкажіть ім'я");
  assertRoleAllowed(me, role);
  const password = String(input.password ?? "").length >= 8 ? String(input.password) : genPassword();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: input.phone ?? null },
  });
  if (error) {
    if (/already/i.test(error.message)) throw new HttpError(409, "Користувач з таким email вже існує");
    throw new HttpError(400, error.message);
  }
  const id = data.user!.id;
  const { error: pErr } = await admin.from("profiles").update({
    role,
    full_name: fullName,
    phone: input.phone || null,
    level: input.level || null,
    age_group: input.age_group || null,
    telegram_chat_id: input.telegram_chat_id ?? null,
    telegram_username: input.telegram_username ?? null,
  }).eq("id", id);
  if (pErr) throw pErr;
  const groupIds: string[] = Array.isArray(input.group_ids) ? input.group_ids : [];
  if (groupIds.length && role === "student") {
    await admin.from("group_members").upsert(groupIds.map((g) => ({ group_id: g, student_id: id })));
  }
  return { id, email, password };
}

async function integrationsStatus() {
  const [botUsername, tgToken, googleAccount, gClient, gSecret, gConnected] = await Promise.all([
    getSetting<string>("telegram_bot_username"),
    getSecret("telegram_bot_token"),
    getSetting<Any>("google_account"),
    getSecret("google_client_id"),
    getSecret("google_client_secret"),
    googleConfigured(),
  ]);
  let webhook: Any = null;
  if (tgToken) webhook = (await tg("getWebhookInfo", {}))?.result ?? null;
  return {
    telegram: {
      configured: !!tgToken,
      bot_username: botUsername,
      webhook_url: webhook?.url ?? null,
      pending_updates: webhook?.pending_update_count ?? 0,
      last_error: webhook?.last_error_message ?? null,
    },
    google: {
      client_configured: !!(gClient && gSecret),
      client_id: gClient ? `${gClient.slice(0, 12)}…` : null,
      connected: gConnected,
      account: googleAccount,
      redirect_uri: `${functionsUrl()}/google-oauth`,
    },
    site_url: await siteUrl(),
  };
}

async function saveTelegram(token: string) {
  token = token.trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) throw new HttpError(422, "Схоже, це не токен бота. Скопіюйте його з @BotFather повністю.");
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
  if (!me.ok) throw new HttpError(422, "Telegram не прийняв токен. Перевірте його в @BotFather.");

  const webhookSecret = randomToken(24);
  await setSecret("telegram_bot_token", token);
  await setSecret("telegram_webhook_secret", webhookSecret);

  const set = await tg("setWebhook", {
    url: `${functionsUrl()}/telegram`,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  if (!set?.ok) throw new HttpError(502, `Не вдалося встановити webhook: ${set?.description ?? "невідома помилка"}`);

  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Головне меню" },
      { command: "menu", description: "Показати меню" },
      { command: "cancel", description: "Скасувати поточну дію" },
    ],
  });
  await tg("setMyShortDescription", { short_description: "Seal English 🦭 — онлайн-школа англійської. Пробний урок безкоштовно!" });
  await tg("setMyDescription", {
    description: "Привіт! Я Сілі — тюлень-талісман школи Seal English 🦭📘\n\n• запис на безкоштовний пробний урок\n• розклад і посилання на уроки в Google Meet\n• нагадування та домашні завдання",
  });
  await setSetting("telegram_bot_username", me.result.username, true);
  await setSetting("telegram_configured", true);
  return { ok: true, bot_username: me.result.username };
}

async function removeTelegram() {
  await tg("deleteWebhook", { drop_pending_updates: true });
  await setSecret("telegram_bot_token", null);
  await setSecret("telegram_webhook_secret", null);
  await setSetting("telegram_bot_username", null, true);
  await setSetting("telegram_configured", false);
  return { ok: true };
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const { profile: me } = await requireUser(req, ["manager", "admin"]);
  const input = await readJson<Any>(req);
  const adminOnly = () => {
    if (me.role !== "admin") throw new HttpError(403, "Доступно лише адміністратору");
  };

  switch (input.action) {
    case "create_user":
      return json(await createAccount(me, input));

    case "convert_lead": {
      const { data: lead } = await admin.from("leads").select("*").eq("id", input.lead_id).maybeSingle();
      if (!lead) throw new HttpError(404, "Заявку не знайдено");
      if (lead.converted_profile_id) throw new HttpError(409, "Цю заявку вже перетворено на учня");
      // Link Telegram automatically if the lead came from the bot and that chat isn't linked yet.
      let chat: number | null = null;
      if (lead.telegram_chat_id) {
        const { data: taken } = await admin.from("profiles").select("id").eq("telegram_chat_id", lead.telegram_chat_id).maybeSingle();
        if (!taken) chat = lead.telegram_chat_id;
      }
      const acc = await createAccount(me, {
        email: input.email ?? lead.email,
        full_name: input.full_name ?? lead.name,
        phone: lead.phone,
        role: "student",
        age_group: lead.age_group,
        level: input.level ?? null,
        group_ids: input.group_ids,
        password: input.password,
        telegram_chat_id: chat,
        telegram_username: chat ? lead.telegram_username : null,
      });
      await admin.from("leads").update({ status: "won", converted_profile_id: acc.id, manager_id: lead.manager_id ?? me.id }).eq("id", lead.id);
      await admin.from("lead_events").insert({ lead_id: lead.id, kind: "status", from_status: lead.status, to_status: "won", actor_id: me.id, body: `Створено акаунт учня ${acc.email}` });
      if (chat) {
        const site = await siteUrl();
        await sendMessage(chat, `🎉 <b>Вітаємо в Seal English!</b>\n\nВаш особистий кабінет готовий:\nЛогін: <code>${acc.email}</code>\nПароль: <code>${acc.password}</code>\n\nЗмініть пароль після першого входу 🔐`, {
          reply_markup: /^https:/.test(site) ? { inline_keyboard: [[{ text: "Увійти в кабінет →", url: `${site}/login/` }]] } : undefined,
        });
      }
      return json({ ...acc, telegram_linked: !!chat });
    }

    case "reset_password": {
      const { data: target } = await admin.from("profiles").select("role").eq("id", input.user_id).maybeSingle();
      if (!target) throw new HttpError(404, "Користувача не знайдено");
      if (target.role === "admin" && me.role !== "admin") throw new HttpError(403, "Недостатньо прав");
      const password = genPassword();
      const { error } = await admin.auth.admin.updateUserById(input.user_id, { password });
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true, password });
    }

    case "update_user": {
      const { data: target } = await admin.from("profiles").select("role").eq("id", input.user_id).maybeSingle();
      if (!target) throw new HttpError(404, "Користувача не знайдено");
      if ((target.role === "admin" || input.role === "admin") && me.role !== "admin") throw new HttpError(403, "Недостатньо прав");
      if (input.user_id === me.id && input.role && input.role !== me.role) throw new HttpError(422, "Не можна змінити власну роль");
      const patch: Record<string, unknown> = {};
      if (input.role) {
        assertRoleAllowed(me, input.role);
        patch.role = input.role;
      }
      if (typeof input.is_active === "boolean") {
        if (input.user_id === me.id) throw new HttpError(422, "Не можна деактивувати себе");
        patch.is_active = input.is_active;
        await admin.auth.admin.updateUserById(input.user_id, { ban_duration: input.is_active ? "none" : "876000h" });
      }
      if (input.email) {
        const { error } = await admin.auth.admin.updateUserById(input.user_id, { email: input.email, email_confirm: true });
        if (error) throw new HttpError(400, error.message);
        patch.email = input.email;
      }
      if (Object.keys(patch).length) {
        const { error } = await admin.from("profiles").update(patch).eq("id", input.user_id);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    case "delete_user": {
      adminOnly();
      if (input.user_id === me.id) throw new HttpError(422, "Не можна видалити себе");
      const { error } = await admin.auth.admin.deleteUser(input.user_id);
      if (error) throw new HttpError(400, error.message.includes("foreign key") ? "Користувач має уроки — деактивуйте його замість видалення" : error.message);
      return json({ ok: true });
    }

    case "integrations_status":
      adminOnly();
      return json(await integrationsStatus());

    case "save_telegram":
      adminOnly();
      return json(await saveTelegram(String(input.token ?? "")));

    case "remove_telegram":
      adminOnly();
      return json(await removeTelegram());

    case "test_telegram": {
      if (!me.telegram_chat_id) throw new HttpError(422, "Спочатку підключіть свій Telegram у профілі");
      const res = await sendMessage(me.telegram_chat_id, "✅ Тестове повідомлення: бот Seal English працює 🦭");
      if (!res?.ok) throw new HttpError(502, res?.description ?? "Бот не налаштовано");
      return json({ ok: true });
    }

    case "save_google_client": {
      adminOnly();
      const clientId = String(input.client_id ?? "").trim();
      const clientSecret = String(input.client_secret ?? "").trim();
      if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new HttpError(422, "Client ID має закінчуватися на .apps.googleusercontent.com");
      if (clientSecret.length < 10) throw new HttpError(422, "Вкажіть Client secret");
      await setSecret("google_client_id", clientId);
      await setSecret("google_client_secret", clientSecret);
      return json({ ok: true });
    }

    case "set_site_url": {
      adminOnly();
      const url = String(input.url ?? "").trim().replace(/\/$/, "");
      if (!/^https?:\/\/[^\s]+$/.test(url)) throw new HttpError(422, "Некоректна адреса сайту");
      await setSetting("site_url", url, true);
      return json({ ok: true });
    }

    default:
      if (!isStaff(me)) throw new HttpError(403, "Недостатньо прав");
      throw new HttpError(400, "Невідома дія");
  }
}));

# notify-week-off

Sends a push notification to every employee in a company when the admin adds/changes a Week-off
(recurring weekly day or a holiday date). Called from `admin-web/app/week-off/page.tsx` right
after a successful save.

The code is ready, but two one-time setup steps need someone with the actual account credentials
— neither can be done from a coding assistant with no browser/stored logins:

## 1. Get a real EAS project ID (mobile-app)

```
cd mobile-app
npx eas login        # your own Expo account
npx eas init          # creates/links an EAS project, prints a projectId
```

Copy the printed `projectId` into `mobile-app/app.json`, replacing
`"REPLACE_WITH_EAS_PROJECT_ID"` under `expo.extra.eas.projectId`. Until this is a real ID,
`lib/pushNotifications.ts`'s `registerForPushNotifications()` silently no-ops — nothing breaks,
employees just never actually get a push token registered.

## 2. Deploy this function

```
cd supabase
npx supabase login    # your own Supabase account
npx supabase link --project-ref <your-project-ref>   # find this in the Supabase dashboard URL
npx supabase functions deploy notify-week-off
```

No extra secrets to configure — it only uses `SUPABASE_URL`/`SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`, which every Edge Function gets automatically.

## Until both are done

`admin-web/app/week-off/page.tsx`'s `notifyWeekOffChange()` calls this function after every save
and silently swallows the error if it's not deployed yet (`supabase.functions.invoke` returns a
"not found"-style error, not a thrown exception) — so Week-off itself works fully without this;
employees just won't get a push until both steps above are done.

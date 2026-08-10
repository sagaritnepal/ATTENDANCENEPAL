import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';

const RELEASES_URL = 'https://api.github.com/repos/sagaritnepal/ATTENDANCENEPAL/releases/latest';

type UpdateInfo = { versionCode: number; downloadUrl: string };

// GitHub Actions (.github/workflows/build-android.yml) tags every release
// "vNNN" where NNN is that build's android versionCode, and attaches the
// APK as a release asset — parsed back out here rather than trusting
// versionName, since versionCode is the number Android actually compares.
function parseRelease(json: any): UpdateInfo | null {
  const match = /^v(\d+)$/.exec(json?.tag_name ?? '');
  if (!match) return null;
  const asset = (json.assets ?? []).find((a: any) => a.name?.endsWith('.apk'));
  if (!asset) return null;
  return { versionCode: Number(match[1]), downloadUrl: asset.browser_download_url };
}

/** Checks GitHub's latest release once per app launch and reports back if
 * it's newer than the build currently installed — silently gives up on any
 * error (offline, rate-limited, no releases yet) rather than ever blocking
 * the app on this being reachable. */
export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    (async () => {
      try {
        const currentVersionCode = Number(Application.nativeBuildVersion);
        if (!currentVersionCode) return;
        const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) return;
        const info = parseRelease(await res.json());
        if (!active || !info) return;
        if (info.versionCode > currentVersionCode) setUpdate(info);
      } catch {
        // Offline or GitHub unreachable — not worth surfacing to the user.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return update;
}

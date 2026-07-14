// Clinician profile — the identity stamped on consult headers, signatures and
// exports. Editable in Settings, persisted on-device in the app_setting kv table
// (never synced or transmitted). Defaults match the original demo persona so a
// fresh install still shows something sensible.

import { useCallback, useEffect, useState } from "react";

import { getSetting, setSetting } from "./db";

export interface ClinicianProfile {
  clinicianName: string;
  mmcNo: string;
  clinicName: string;
}

export const PROFILE_DEFAULTS: ClinicianProfile = {
  clinicianName: "Dr. A. Tan",
  mmcNo: "MMC 45678",
  clinicName: "Klinik Sihat",
};

const KEY = "clinician_profile";

// Module cache so screens that already loaded the profile render instantly.
let cached: ClinicianProfile | null = null;

export async function getProfile(): Promise<ClinicianProfile> {
  if (cached) return cached;
  try {
    const raw = await getSetting(KEY);
    cached = raw ? { ...PROFILE_DEFAULTS, ...(JSON.parse(raw) as Partial<ClinicianProfile>) } : PROFILE_DEFAULTS;
  } catch {
    cached = PROFILE_DEFAULTS;
  }
  return cached;
}

export async function saveProfile(patch: Partial<ClinicianProfile>): Promise<ClinicianProfile> {
  const next = { ...(await getProfile()), ...sanitize(patch) };
  cached = next;
  await setSetting(KEY, JSON.stringify(next));
  return next;
}

function sanitize(patch: Partial<ClinicianProfile>): Partial<ClinicianProfile> {
  const out: Partial<ClinicianProfile> = {};
  for (const k of ["clinicianName", "mmcNo", "clinicName"] as const) {
    const v = patch[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Profile for screens: defaults immediately, stored values once loaded. */
export function useProfile(): [ClinicianProfile, (patch: Partial<ClinicianProfile>) => void] {
  const [profile, setProfile] = useState<ClinicianProfile>(cached ?? PROFILE_DEFAULTS);
  useEffect(() => {
    let alive = true;
    void getProfile().then((p) => alive && setProfile(p));
    return () => {
      alive = false;
    };
  }, []);
  const update = useCallback((patch: Partial<ClinicianProfile>) => {
    void saveProfile(patch).then(setProfile);
  }, []);
  return [profile, update];
}

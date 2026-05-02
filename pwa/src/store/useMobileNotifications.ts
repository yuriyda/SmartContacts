/**
 * @file useMobileNotifications.ts
 * Wrapper around @capacitor/local-notifications for the daily fire.
 *
 * Behavior:
 *  - On enable: request permission. If granted, schedule a daily notification at the user's hour.
 *  - On disable: cancel the schedule.
 *  - Schedule uses LocalNotifications.schedule with `every: 'day'` so the OS handles repeating fire
 *    even when the app is closed.
 *  - Body is generic ("Check your contacts today") — see spec §22.7 for why dynamic body is out of scope.
 *
 * Rules: caller (SettingsScreen) owns the meta-state mutations; this hook only talks to the plugin.
 */
import { LocalNotifications } from '@capacitor/local-notifications'

const NOTIFICATION_ID = 1

export interface ScheduleInput {
  hour: number // 0..23
}

export async function requestPermissionAndSchedule(
  input: ScheduleInput,
): Promise<{ ok: boolean; reason?: string }> {
  const perm = await LocalNotifications.requestPermissions()
  if (perm.display !== 'granted') {
    return { ok: false, reason: 'permission_denied' }
  }

  const at = nextDailyFire(input.hour)
  await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] })
  await LocalNotifications.schedule({
    notifications: [
      {
        id: NOTIFICATION_ID,
        title: 'Smart Contacts',
        body: 'Check your contacts today',
        schedule: {
          at,
          every: 'day',
          repeats: true,
        },
        smallIcon: 'ic_stat_icon_config_sample',
      },
    ],
  })
  return { ok: true }
}

export async function cancelDailyNotification(): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] })
  } catch {
    // Plugin may throw if no schedule exists; swallow.
  }
}

function nextDailyFire(hour: number): Date {
  const target = new Date()
  target.setHours(hour, 0, 0, 0)
  if (target.getTime() <= Date.now()) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

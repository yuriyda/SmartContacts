/**
 * @file OnboardingTab.tsx
 * Settings tab: controls for replaying the welcome guide.
 *
 * Rules:
 *  - onResetGuide is passed from SmartContactsApp; this tab only calls it.
 *  - GuideOverlay itself is Task 13; this file only wires the trigger.
 *  - No DB access in this file.
 */
import { useApp } from '../AppContext'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingTabProps {
  onResetGuide: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OnboardingTab({ onResetGuide }: OnboardingTabProps) {
  const { TC, t } = useApp()

  return (
    <div className="space-y-3 py-2">
      <p className={`text-sm ${TC.textSec}`}>
        Replay the welcome guide that shows on first launch.
      </p>
      <button
        type="button"
        onClick={() => void onResetGuide()}
        className="px-4 py-2 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white"
      >
        {t('actions.replay_guide')}
      </button>
    </div>
  )
}

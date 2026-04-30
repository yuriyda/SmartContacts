/**
 * @file GuideOverlay.tsx
 * First-run onboarding overlay with 3 slides (prev/next/got-it navigation).
 * Shown when metaSettings.guide_dismissed !== '1', or when replayed from Settings.
 * Rules: no DB access; receives open/onDismiss from SmartContactsApp.
 * Slide content comes from i18n (guide.slide1..3). Do not hardcode user-facing text here.
 */
import { useState } from 'react'
import { useApp } from './AppContext'
import { X } from './icons'

interface GuideOverlayProps {
  open: boolean
  onDismiss: () => void
}

export function GuideOverlay({ open, onDismiss }: GuideOverlayProps) {
  const { t, TC } = useApp()
  const [slide, setSlide] = useState(0)

  if (!open) return null

  const slides = [
    { title: t('guide.slide1.title'), body: t('guide.slide1.body') },
    { title: t('guide.slide2.title'), body: t('guide.slide2.body') },
    { title: t('guide.slide3.title'), body: t('guide.slide3.body') },
  ]
  const last = slide === slides.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className={`${TC.surface} ${TC.text} border ${TC.borderClass} rounded-lg shadow-2xl w-full max-w-md p-6`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('guide.title')}</h2>
          <button onClick={onDismiss} className={TC.textSec} aria-label="dismiss">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-[140px]">
          <h3 className="text-base font-medium mb-2">{slides[slide]!.title}</h3>
          <p className={`text-sm ${TC.textSec}`}>{slides[slide]!.body}</p>
        </div>

        <div className="flex items-center justify-between mt-6">
          {/* Dot indicators */}
          <div className={`flex items-center gap-1 ${TC.textMuted} text-xs`}>
            {slides.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full ${i === slide ? 'bg-sky-500' : 'bg-gray-500/40'}`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            {slide > 0 && (
              <button
                onClick={() => setSlide((s) => s - 1)}
                className={`px-3 py-1 rounded text-sm ${TC.surfaceAlt} ${TC.text}`}
              >
                {t('guide.prev')}
              </button>
            )}
            {!last && (
              <button
                onClick={() => setSlide((s) => s + 1)}
                className="px-3 py-1 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white"
              >
                {t('guide.next')}
              </button>
            )}
            {last && (
              <button
                onClick={onDismiss}
                className="px-3 py-1 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white"
              >
                {t('guide.got_it')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

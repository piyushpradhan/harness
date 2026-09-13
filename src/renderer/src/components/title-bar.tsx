import { useEffect, useState } from 'react'

import type { WindowChromeState } from '@shared/window-chrome'

const INITIAL_STATE: WindowChromeState = {
  focused: true,
  maximized: false,
  fullScreen: false,
}

function useWindowChrome(): WindowChromeState {
  const [state, setState] = useState<WindowChromeState>(INITIAL_STATE)

  useEffect(() => {
    const chrome = window.api?.window
    if (!chrome) return
    let cancelled = false
    void chrome.getState().then((next) => {
      if (!cancelled) setState(next)
    })
    const unsubscribe = chrome.onState(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}

function useAltKey(): boolean {
  const [alt, setAlt] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAlt(event.type === 'keydown')
    }
    const onBlur = () => setAlt(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return alt
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3.6 3.6l4.8 4.8m0-4.8l-4.8 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MinimizeGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.8 6h6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ZoomGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.8 6h6.4M6 2.8v6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FullScreenEnterGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6.6 2.4h3v3L6.6 2.4zm-4.2 4.2v3h3L2.4 6.6z" />
    </svg>
  )
}

function FullScreenExitGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M9.6 5.4H6.6V2.4L9.6 5.4zM2.4 6.6H5.4v3L2.4 6.6z" />
    </svg>
  )
}

function TrafficLights({ state }: { state: WindowChromeState }) {
  const alt = useAltKey()
  const greenIsZoom = alt
  const greenLabel = greenIsZoom
    ? 'Zoom'
    : state.fullScreen
      ? 'Exit Full Screen'
      : 'Enter Full Screen'

  return (
    <div className="traffic-lights app-no-drag" data-focused={state.focused ? 'true' : 'false'}>
      <button
        type="button"
        className="traffic-light traffic-light-close"
        aria-label="Close"
        onClick={() => {
          void window.api?.window?.close()
        }}
      >
        <CloseGlyph />
      </button>
      <button
        type="button"
        className="traffic-light traffic-light-min"
        aria-label="Minimize"
        onClick={() => {
          void window.api?.window?.minimize()
        }}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="traffic-light traffic-light-max"
        aria-label={greenLabel}
        onClick={() => {
          if (greenIsZoom) void window.api?.window?.zoom()
          else void window.api?.window?.toggleFullScreen()
        }}
      >
        {greenIsZoom ? (
          <ZoomGlyph />
        ) : state.fullScreen ? (
          <FullScreenExitGlyph />
        ) : (
          <FullScreenEnterGlyph />
        )}
      </button>
    </div>
  )
}

export function TitleBar() {
  const state = useWindowChrome()
  const nativeControls = window.api?.platform === 'darwin'

  return (
    <header
      className="titlebar app-drag"
      data-focused={state.focused ? 'true' : 'false'}
      onDoubleClick={(event) => {
        if (nativeControls) return
        if ((event.target as HTMLElement).closest('button')) return
        void window.api?.window?.zoom()
      }}
    >
      {nativeControls ? null : <TrafficLights state={state} />}
      <h1 className="titlebar-title">Harness</h1>
    </header>
  )
}

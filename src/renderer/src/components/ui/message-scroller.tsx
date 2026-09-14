import * as React from 'react'
import { ArrowDownIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type MessageScrollerDefaultScrollPosition = 'start' | 'end' | 'last-anchor'
type MessageScrollerButtonDirection = 'start' | 'end'
type MessageScrollerScrollAlign = 'start' | 'center' | 'end' | 'nearest'

interface MessageScrollerScrollOptions {
  align?: MessageScrollerScrollAlign
  behavior?: ScrollBehavior
  scrollMargin?: number
}

interface MessageScrollerScrollable {
  start: boolean
  end: boolean
}

interface MessageScrollerVisibilityState {
  currentAnchorId: string | null
  visibleMessageIds: string[]
}

interface MessageScrollerButtonRenderState {
  active: boolean
  direction: MessageScrollerButtonDirection
}

type MessageScrollerButtonRenderProps = React.ComponentProps<'button'> & {
  'data-active': 'true' | 'false'
  'data-direction': MessageScrollerButtonDirection
  'data-variant'?: string
  'data-size'?: string
}

const EMPTY_SCROLLABLE: MessageScrollerScrollable = { start: false, end: false }
const EMPTY_VISIBILITY: MessageScrollerVisibilityState = {
  currentAnchorId: null,
  visibleMessageIds: [],
}

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])
const AUTOSCROLL_RESET_MS = 180

function createStore<T>(initial: T, isEqual: (a: T, b: T) => boolean = Object.is) {
  let state = initial
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => state,
    hasListeners: () => listeners.size > 0,
    setSnapshot: (next: T) => {
      if (isEqual(state, next)) return
      state = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

interface MessageScrollerContextValue {
  registerRoot: (element: HTMLDivElement | null) => void
  registerViewport: (element: HTMLDivElement | null) => void
  registerContent: (element: HTMLDivElement | null) => void
  registerItem: (messageId: string | null, element: HTMLDivElement | null, previous: HTMLDivElement | null) => void
  handleContentChange: () => void
  handleResize: () => void
  syncAfterScroll: () => void
  userScrollIntent: () => void
  scrollToEnd: (options?: MessageScrollerScrollOptions) => boolean
  scrollToStart: (options?: MessageScrollerScrollOptions) => boolean
  scrollToMessage: (messageId: string, options?: MessageScrollerScrollOptions) => boolean
  scrollableStore: ReturnType<typeof createStore<MessageScrollerScrollable>>
  visibilityStore: ReturnType<typeof createStore<MessageScrollerVisibilityState>>
  pendingDefaultScrollStore: ReturnType<typeof createStore<boolean>>
  preserveScrollOnPrependRef: React.RefObject<boolean>
}

const MessageScrollerContext = React.createContext<MessageScrollerContextValue | null>(null)

function useMessageScrollerContext(): MessageScrollerContextValue {
  const context = React.useContext(MessageScrollerContext)
  if (!context) {
    throw new Error('useMessageScroller must be used within a MessageScroller.')
  }
  return context
}

function MessageScrollerProvider({
  autoScroll = false,
  defaultScrollPosition = 'end',
  scrollEdgeThreshold = 8,
  scrollPreviousItemPeek = 64,
  scrollMargin = 0,
  children,
}: {
  children?: React.ReactNode
  autoScroll?: boolean
  defaultScrollPosition?: MessageScrollerDefaultScrollPosition
  scrollEdgeThreshold?: number
  scrollPreviousItemPeek?: number
  scrollMargin?: number
}) {
  const autoScrollRef = React.useRef(autoScroll)
  const defaultScrollPositionRef = React.useRef(defaultScrollPosition)
  const scrollEdgeThresholdRef = React.useRef(scrollEdgeThreshold)
  const scrollPreviousItemPeekRef = React.useRef(scrollPreviousItemPeek)
  const scrollMarginRef = React.useRef(scrollMargin)
  const preserveScrollOnPrependRef = React.useRef(true)

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const itemsRef = React.useRef(new Map<string, HTMLDivElement>())
  const visibleIdsRef = React.useRef(new Set<string>())
  const visibilityObserverRef = React.useRef<IntersectionObserver | null>(null)
  const prevCountRef = React.useRef(0)
  const prevFirstRef = React.useRef<HTMLElement | null>(null)
  const defaultAppliedRef = React.useRef(false)
  const pinnedRef = React.useRef(autoScroll)
  const lastScrollTopRef = React.useRef(0)
  const autoscrollingRef = React.useRef(false)
  const autoscrollingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreIdRef = React.useRef<string | null>(null)
  const restoreOffsetRef = React.useRef(0)
  const syncFrameRef = React.useRef<number | null>(null)
  const visibilityFrameRef = React.useRef<number | null>(null)

  const [scrollableStore] = React.useState(() =>
    createStore(EMPTY_SCROLLABLE, (a, b) => a.start === b.start && a.end === b.end),
  )
  const [visibilityStore] = React.useState(() =>
    createStore(
      EMPTY_VISIBILITY,
      (a, b) =>
        a.currentAnchorId === b.currentAnchorId &&
        a.visibleMessageIds.length === b.visibleMessageIds.length &&
        a.visibleMessageIds.every((id, index) => id === b.visibleMessageIds[index]),
    ),
  )
  const [pendingDefaultScrollStore] = React.useState(() =>
    createStore(defaultScrollPosition === 'end' || defaultScrollPosition === 'last-anchor'),
  )

  // Keep the latest prop values available to stable callbacks.
  autoScrollRef.current = autoScroll
  defaultScrollPositionRef.current = defaultScrollPosition
  scrollEdgeThresholdRef.current = scrollEdgeThreshold
  scrollPreviousItemPeekRef.current = scrollPreviousItemPeek
  scrollMarginRef.current = scrollMargin

  const commitScrollState = React.useCallback(() => {
    const parts = [
      scrollableStore.getSnapshot().start && 'start',
      scrollableStore.getSnapshot().end && 'end',
    ]
      .filter(Boolean)
      .join(' ')
    const autoscrolling = autoscrollingRef.current
    for (const element of [rootRef.current, viewportRef.current]) {
      if (!element) continue
      if (parts) element.setAttribute('data-scrollable', parts)
      else element.removeAttribute('data-scrollable')
      element.toggleAttribute('data-autoscrolling', autoscrolling)
    }
  }, [scrollableStore])

  const setAutoscrolling = React.useCallback(
    (next: boolean) => {
      if (autoscrollingTimeoutRef.current !== null) {
        clearTimeout(autoscrollingTimeoutRef.current)
        autoscrollingTimeoutRef.current = null
      }
      if (autoscrollingRef.current !== next) {
        autoscrollingRef.current = next
        commitScrollState()
      }
      if (next) {
        autoscrollingTimeoutRef.current = setTimeout(() => {
          autoscrollingTimeoutRef.current = null
          autoscrollingRef.current = false
          commitScrollState()
        }, AUTOSCROLL_RESET_MS)
      }
    },
    [commitScrollState],
  )

  const getContentPadding = React.useCallback(() => {
    const content = contentRef.current
    if (!content) return { top: 0, bottom: 0 }
    const style = window.getComputedStyle(content)
    const parse = (value: string) => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return {
      top: parse(style.paddingBlockStart || style.paddingTop),
      bottom: parse(style.paddingBlockEnd || style.paddingBottom),
    }
  }, [])

  const computeScrollable = React.useCallback((): MessageScrollerScrollable => {
    const viewport = viewportRef.current
    if (!viewport) return EMPTY_SCROLLABLE
    const threshold = scrollEdgeThresholdRef.current
    return {
      start: viewport.scrollTop > threshold,
      end: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > threshold,
    }
  }, [])

  const saveRestoreAnchor = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const viewportRect = viewport.getBoundingClientRect()
    for (const element of itemsRef.current.values()) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
        restoreIdRef.current = element.dataset.messageId ?? null
        restoreOffsetRef.current = rect.top - viewportRect.top
        return
      }
    }
    restoreIdRef.current = null
  }, [])

  const syncVisibility = React.useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const boundary =
      viewport.getBoundingClientRect().top +
      scrollMarginRef.current +
      scrollPreviousItemPeekRef.current
    let currentAnchorId: string | null = null
    const visibleMessageIds: string[] = []
    for (const child of Array.from(content.children)) {
      if (!(child instanceof HTMLElement)) continue
      const messageId = child.dataset.messageId
      if (!messageId) continue
      if (visibleIdsRef.current.has(messageId)) visibleMessageIds.push(messageId)
      if (child.dataset.scrollAnchor === 'true' && child.getBoundingClientRect().top <= boundary + 0.5) {
        currentAnchorId = messageId
      }
    }
    visibilityStore.setSnapshot({ currentAnchorId, visibleMessageIds })
  }, [visibilityStore])

  const scheduleVisibilitySync = React.useCallback(() => {
    if (visibilityFrameRef.current !== null) return
    visibilityFrameRef.current = requestAnimationFrame(() => {
      visibilityFrameRef.current = null
      if (visibilityStore.hasListeners()) syncVisibility()
    })
  }, [syncVisibility, visibilityStore])

  const syncScrollState = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scrollable = computeScrollable()
    const scrolledUp = viewport.scrollTop < lastScrollTopRef.current - 0.5
    lastScrollTopRef.current = viewport.scrollTop
    if (autoScrollRef.current) {
      if (!scrollable.end) pinnedRef.current = true
      else if (scrolledUp && !autoscrollingRef.current) pinnedRef.current = false
    } else {
      pinnedRef.current = false
    }
    saveRestoreAnchor()
    scrollableStore.setSnapshot(scrollable)
    commitScrollState()
    scheduleVisibilitySync()
  }, [commitScrollState, computeScrollable, saveRestoreAnchor, scheduleVisibilitySync, scrollableStore])

  const scheduleScrollSync = React.useCallback(() => {
    if (syncFrameRef.current !== null) return
    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null
      syncScrollState()
    })
  }, [syncScrollState])

  const scrollTo = React.useCallback(
    (top: number, options: { behavior?: ScrollBehavior } = {}) => {
      const viewport = viewportRef.current
      if (!viewport) return false
      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const target = Math.min(Math.max(0, top), maxScroll)
      if (Math.abs(viewport.scrollTop - target) <= 0.5) {
        viewport.scrollTop = target
        scheduleScrollSync()
        return true
      }
      viewport.scrollTo({ top: target, behavior: options.behavior ?? 'auto' })
      scheduleScrollSync()
      scheduleVisibilitySync()
      return true
    },
    [scheduleScrollSync, scheduleVisibilitySync],
  )

  const scrollToStart = React.useCallback(
    (options: MessageScrollerScrollOptions = {}) => {
      pinnedRef.current = false
      return scrollTo(0, options)
    },
    [scrollTo],
  )

  const scrollToEnd = React.useCallback(
    (options: MessageScrollerScrollOptions = {}) => {
      const viewport = viewportRef.current
      if (!viewport) return false
      pinnedRef.current = autoScrollRef.current
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (Math.abs(viewport.scrollTop - target) <= 0.5) {
        // Already at the bottom: just refresh state, no scrollbar churn.
        scheduleScrollSync()
        scheduleVisibilitySync()
        return true
      }
      setAutoscrolling(true)
      return scrollTo(target, options)
    },
    [scheduleScrollSync, scheduleVisibilitySync, scrollTo, setAutoscrolling],
  )

  const scrollToElement = React.useCallback(
    (element: HTMLElement, options: Required<MessageScrollerScrollOptions> & { keepPreviousPeek?: boolean }) => {
      const viewport = viewportRef.current
      if (!viewport) return false
      const { align, behavior, scrollMargin: margin } = options
      const rect = element.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      const padding = getContentPadding()
      const elementTop = rect.top - viewportRect.top + viewport.scrollTop
      const elementHeight = rect.height
      const clientHeight = viewport.clientHeight

      let target: number
      switch (align) {
        case 'center':
          target = elementTop - padding.top - (clientHeight - elementHeight) / 2 - margin
          break
        case 'end':
          target = elementTop + elementHeight - clientHeight + padding.bottom + margin
          break
        case 'nearest': {
          const elementBottom = elementTop + elementHeight
          const visibleTop = viewport.scrollTop
          const visibleBottom = viewport.scrollTop + clientHeight
          if (elementTop >= visibleTop && elementBottom <= visibleBottom) return true
          target =
            elementTop < visibleTop
              ? elementTop - padding.top - margin
              : elementBottom - clientHeight + padding.bottom + margin
          break
        }
        default:
          target = elementTop - padding.top - margin
      }

      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      pinnedRef.current = target >= maxScroll - scrollEdgeThresholdRef.current
      return scrollTo(target, { behavior })
    },
    [getContentPadding, scrollTo],
  )

  const scrollToMessage = React.useCallback(
    (messageId: string, options: MessageScrollerScrollOptions = {}) => {
      const element = itemsRef.current.get(messageId)
      if (!element?.isConnected) return false
      const { align = 'start', behavior = 'auto', scrollMargin: margin = scrollMarginRef.current } = options
      return scrollToElement(element, { align, behavior, scrollMargin: margin })
    },
    [scrollToElement],
  )

  const applyDefaultScrollPosition = React.useCallback((): boolean => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return false
    const position = defaultScrollPositionRef.current
    if (position === 'start') return scrollToStart({ behavior: 'auto' })
    if (position === 'end') return scrollToEnd({ behavior: 'auto' })
    const anchors = Array.from(content.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.dataset.scrollAnchor === 'true',
    )
    const lastAnchor = anchors[anchors.length - 1]
    if (!lastAnchor) return scrollToEnd({ behavior: 'auto' })
    scrollToElement(lastAnchor, { align: 'start', behavior: 'auto', scrollMargin: scrollMarginRef.current })
    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    if (maxScroll - viewport.scrollTop <= viewport.clientHeight) return scrollToEnd({ behavior: 'auto' })
    return true
  }, [scrollToElement, scrollToEnd, scrollToStart])

  const handleContentChange = React.useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const children = Array.from(content.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    )
    const count = children.length
    const prevCount = prevCountRef.current
    const prevFirst = prevFirstRef.current
    prevCountRef.current = count
    prevFirstRef.current = children[0] ?? null

    if (prevCount === 0) {
      if (!defaultAppliedRef.current) {
        requestAnimationFrame(() => {
          defaultAppliedRef.current = true
          pendingDefaultScrollStore.setSnapshot(false)
          applyDefaultScrollPosition()
        })
      }
      scheduleScrollSync()
      return
    }

    if (count > prevCount && children[0] !== prevFirst) {
      // Content was prepended: keep the previously visible message in place.
      if (!(pinnedRef.current && autoScrollRef.current) && preserveScrollOnPrependRef.current) {
        const restoreId = restoreIdRef.current
        const element = restoreId ? itemsRef.current.get(restoreId) : undefined
        if (element?.isConnected) {
          const delta =
            element.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            restoreOffsetRef.current
          if (Math.abs(delta) > 0.5) viewport.scrollTop += delta
        }
        scheduleScrollSync()
        return
      }
    }

    if (pinnedRef.current && autoScrollRef.current) scrollToEnd({ behavior: 'auto' })
    else scheduleScrollSync()
  }, [applyDefaultScrollPosition, pendingDefaultScrollStore, scheduleScrollSync, scrollToEnd])

  const handleResize = React.useCallback(() => {
    if (pinnedRef.current && autoScrollRef.current) scrollToEnd({ behavior: 'auto' })
    else scheduleScrollSync()
  }, [scheduleScrollSync, scrollToEnd])

  const userScrollIntent = React.useCallback(() => {
    pinnedRef.current = false
  }, [])

  const ensureVisibilityObserver = React.useCallback(() => {
    if (typeof IntersectionObserver === 'undefined') return null
    visibilityObserverRef.current ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const messageId = (entry.target as HTMLElement).dataset.messageId
          if (!messageId) continue
          if (entry.isIntersecting) visibleIdsRef.current.add(messageId)
          else visibleIdsRef.current.delete(messageId)
        }
        scheduleVisibilitySync()
      },
      {
        root: viewportRef.current,
        rootMargin: `-${scrollMarginRef.current + scrollPreviousItemPeekRef.current}px 0px 0px 0px`,
        threshold: [0, 0.01, 0.5, 1],
      },
    )
    return visibilityObserverRef.current
  }, [scheduleVisibilitySync])

  const registerItem = React.useCallback(
    (messageId: string | null, element: HTMLDivElement | null, previous: HTMLDivElement | null) => {
      if (messageId && element) {
        itemsRef.current.set(messageId, element)
        ensureVisibilityObserver()?.observe(element)
        scheduleVisibilitySync()
        return
      }
      if (messageId && previous) {
        if (itemsRef.current.get(messageId) === previous) itemsRef.current.delete(messageId)
        visibleIdsRef.current.delete(messageId)
        visibilityObserverRef.current?.unobserve(previous)
        scheduleVisibilitySync()
      }
    },
    [ensureVisibilityObserver, scheduleVisibilitySync],
  )

  const registerRoot = React.useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element
      commitScrollState()
    },
    [commitScrollState],
  )

  const registerViewport = React.useCallback(
    (element: HTMLDivElement | null) => {
      viewportRef.current = element
      commitScrollState()
      scheduleScrollSync()
    },
    [commitScrollState, scheduleScrollSync],
  )

  const registerContent = React.useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element
  }, [])

  React.useEffect(() => {
    return () => {
      if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current)
      if (visibilityFrameRef.current !== null) cancelAnimationFrame(visibilityFrameRef.current)
      if (autoscrollingTimeoutRef.current !== null) clearTimeout(autoscrollingTimeoutRef.current)
      visibilityObserverRef.current?.disconnect()
      visibilityObserverRef.current = null
    }
  }, [])

  const context = React.useMemo(
    () => ({
      registerRoot,
      registerViewport,
      registerContent,
      registerItem,
      handleContentChange,
      handleResize,
      syncAfterScroll: syncScrollState,
      userScrollIntent,
      scrollToEnd,
      scrollToStart,
      scrollToMessage,
      scrollableStore,
      visibilityStore,
      pendingDefaultScrollStore,
      preserveScrollOnPrependRef,
    }),
    [
      registerRoot,
      registerViewport,
      registerContent,
      registerItem,
      handleContentChange,
      handleResize,
      syncScrollState,
      userScrollIntent,
      scrollToEnd,
      scrollToStart,
      scrollToMessage,
      scrollableStore,
      visibilityStore,
      pendingDefaultScrollStore,
    ],
  )

  return <MessageScrollerContext.Provider value={context}>{children}</MessageScrollerContext.Provider>
}

function usePendingDefaultScroll(): boolean {
  const context = useMessageScrollerContext()
  return React.useSyncExternalStore(
    context.pendingDefaultScrollStore.subscribe,
    context.pendingDefaultScrollStore.getSnapshot,
    context.pendingDefaultScrollStore.getSnapshot,
  )
}

function useMessageScrollerScrollable(): MessageScrollerScrollable {
  const context = useMessageScrollerContext()
  return React.useSyncExternalStore(
    context.scrollableStore.subscribe,
    context.scrollableStore.getSnapshot,
    context.scrollableStore.getSnapshot,
  )
}

function useMessageScrollerVisibility(): MessageScrollerVisibilityState {
  const context = useMessageScrollerContext()
  return React.useSyncExternalStore(
    context.visibilityStore.subscribe,
    context.visibilityStore.getSnapshot,
    context.visibilityStore.getSnapshot,
  )
}

function useMessageScroller() {
  const context = useMessageScrollerContext()
  return React.useMemo(
    () => ({
      scrollToEnd: context.scrollToEnd,
      scrollToMessage: context.scrollToMessage,
      scrollToStart: context.scrollToStart,
    }),
    [context],
  )
}

function MessageScroller({ className, ...props }: React.ComponentProps<'div'>) {
  const context = useMessageScrollerContext()
  const pendingDefaultScroll = usePendingDefaultScroll()
  return (
    <div
      ref={context.registerRoot}
      data-slot="message-scroller"
      data-pending-scroll={pendingDefaultScroll ? '' : undefined}
      className={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  'aria-label': ariaLabel,
  children,
  onKeyDown,
  onScroll,
  onTouchMove,
  onWheel,
  preserveScrollOnPrepend = true,
  ref,
  role,
  tabIndex,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  preserveScrollOnPrepend?: boolean
  ref?: React.Ref<HTMLDivElement>
}) {
  const context = useMessageScrollerContext()
  context.preserveScrollOnPrependRef.current = preserveScrollOnPrepend
  const pendingDefaultScroll = usePendingDefaultScroll()
  const viewportRef = React.useRef<HTMLDivElement | null>(null)

  const composedRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      viewportRef.current = element
      context.registerViewport(element)
      if (typeof ref === 'function') ref(element)
      else if (ref) ref.current = element
    },
    [context, ref],
  )

  React.useEffect(() => {
    const element = viewportRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => context.handleResize())
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [context])

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    context.syncAfterScroll()
    onScroll?.(event)
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    context.userScrollIntent()
    onWheel?.(event)
  }

  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    context.userScrollIntent()
    onTouchMove?.(event)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (SCROLL_KEYS.has(event.key)) context.userScrollIntent()
    onKeyDown?.(event)
  }

  return (
    <div
      ref={composedRef}
      role={role ?? 'region'}
      aria-label={ariaLabel ?? 'Messages'}
      tabIndex={tabIndex ?? 0}
      data-slot="message-scroller-viewport"
      data-pending-scroll={pendingDefaultScroll ? '' : undefined}
      onKeyDown={handleKeyDown}
      onScroll={handleScroll}
      onTouchMove={handleTouchMove}
      onWheel={handleWheel}
      className={cn(
        'size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content scroll-fade-b scrollbar-thin scrollbar-gutter-stable data-autoscrolling:scrollbar-none data-pending-scroll:invisible',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function MessageScrollerContent({
  'aria-relevant': ariaRelevant,
  children,
  ref,
  role,
  className,
  ...props
}: React.ComponentProps<'div'> & { ref?: React.Ref<HTMLDivElement> }) {
  const context = useMessageScrollerContext()
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const composedRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      contentRef.current = element
      context.registerContent(element)
      if (typeof ref === 'function') ref(element)
      else if (ref) ref.current = element
    },
    [context, ref],
  )

  React.useLayoutEffect(() => {
    context.handleContentChange()
  }, [context])

  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      context.handleContentChange()
    })
    observer.observe(content, { childList: true })
    return () => {
      observer.disconnect()
    }
  }, [context])

  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => context.handleResize())
    })
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [context])

  return (
    <div
      ref={composedRef}
      role={role ?? 'log'}
      aria-relevant={ariaRelevant ?? 'additions'}
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-8', className)}
      {...props}
    >
      {children}
    </div>
  )
}

function MessageScrollerItem({
  messageId,
  scrollAnchor = false,
  ref,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  messageId?: string
  scrollAnchor?: boolean
  ref?: React.Ref<HTMLDivElement>
}) {
  const context = useMessageScrollerContext()
  const itemRef = React.useRef<HTMLDivElement | null>(null)

  const composedRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      const previous = itemRef.current
      itemRef.current = element
      context.registerItem(messageId ?? null, element, previous)
      if (typeof ref === 'function') ref(element)
      else if (ref) ref.current = element
    },
    [context, messageId, ref],
  )

  return (
    <div
      ref={composedRef}
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor ? 'true' : 'false'}
      data-slot="message-scroller-item"
      className={cn(
        'min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]',
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerButton({
  behavior = 'smooth',
  direction = 'end',
  className,
  children,
  render,
  variant = 'secondary',
  size = 'icon-sm',
  onClick,
  tabIndex,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'> & {
    behavior?: ScrollBehavior
    direction?: MessageScrollerButtonDirection
    render?:
      | React.ReactElement
      | ((renderProps: MessageScrollerButtonRenderProps, state: MessageScrollerButtonRenderState) => React.ReactElement | null)
  }) {
  const context = useMessageScrollerContext()
  const scrollable = useMessageScrollerScrollable()
  const active = direction === 'start' ? scrollable.start : scrollable.end

  const merged: MessageScrollerButtonRenderProps = {
    type,
    inert: !active,
    tabIndex: active ? tabIndex : -1,
    'data-active': active ? 'true' : 'false',
    'data-direction': direction,
    'data-variant': variant ?? undefined,
    'data-size': size ?? undefined,
    className: cn(
      'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180',
      className,
    ),
    children:
      children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === 'end' ? 'Scroll to end' : 'Scroll to start'}
          </span>
        </>
      ),
    onClick: (event) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      event.currentTarget.blur()
      if (direction === 'start') context.scrollToStart({ behavior })
      else context.scrollToEnd({ behavior })
    },
  }

  const renderProps = mergeButtonProps(merged, props)
  if (typeof render === 'function') return render(renderProps, { active, direction }) ?? null
  const element = React.isValidElement(render) ? render : <Button variant={variant} size={size} />
  return React.cloneElement(element, mergeButtonProps(renderProps, element.props as Record<string, unknown>))
}

function mergeButtonProps(
  base: MessageScrollerButtonRenderProps,
  override: Record<string, unknown> | undefined,
): MessageScrollerButtonRenderProps {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined) continue
    if (key === 'className') merged[key] = [merged[key], value].filter(Boolean).join(' ')
    else if (key === 'style') merged[key] = { ...(merged[key] as object), ...(value as object) }
    else merged[key] = value
  }
  return merged as unknown as MessageScrollerButtonRenderProps
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
  type MessageScrollerDefaultScrollPosition,
  type MessageScrollerButtonDirection,
  type MessageScrollerScrollAlign,
  type MessageScrollerScrollOptions,
  type MessageScrollerScrollable,
  type MessageScrollerVisibilityState,
}

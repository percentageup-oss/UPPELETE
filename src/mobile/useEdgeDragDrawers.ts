import { useState, useRef, useEffect, useCallback } from 'react'

export type DrawerType = 'left' | 'right' | 'bottom' | null

export interface DrawerDragState {
  activeDrawer: DrawerType
  draggingDrawer: DrawerType
  dragOffset: number
  isDragging: boolean
  openDrawer: (drawer: DrawerType) => void
  closeDrawer: () => void
  toggleDrawer: (drawer: 'left' | 'right' | 'bottom') => void
  handleEdgePointerDown: (drawer: 'left' | 'right' | 'bottom', event: React.PointerEvent) => void
  handleDrawerPointerDown: (drawer: 'left' | 'right' | 'bottom', event: React.PointerEvent) => void
  getDrawerStyle: (drawer: 'left' | 'right' | 'bottom') => React.CSSProperties
  isMobile: boolean
}

const EDGE_SNAP_THRESHOLD = 0.25
const FLICK_VELOCITY_THRESHOLD = 0.35 // px per ms

export function useEdgeDragDrawers(breakpoint = 899, forceMobile?: boolean): DrawerDragState {
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null)
  const [draggingDrawer, setDraggingDrawer] = useState<DrawerType>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Track viewport size & mobile state
  const [isMobile, setIsMobile] = useState(() => {
    if (forceMobile !== undefined) return forceMobile
    if (typeof window === 'undefined') return false
    return window.innerWidth <= breakpoint
  })

  useEffect(() => {
    if (forceMobile !== undefined) {
      setIsMobile(forceMobile)
      return
    }
    if (typeof window === 'undefined') return
    const update = () => setIsMobile(window.innerWidth <= breakpoint)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [breakpoint, forceMobile])

  const dragSession = useRef<{
    drawer: 'left' | 'right' | 'bottom'
    isClosing: boolean
    startX: number
    startY: number
    startTime: number
    lastCoord: number
    lastTime: number
    velocity: number
    targetElement: HTMLElement | null
    pointerId: number
    maxDimension: number
  } | null>(null)

  const openDrawer = useCallback((drawer: DrawerType) => {
    setActiveDrawer(drawer)
    setDraggingDrawer(null)
    setDragOffset(0)
    setIsDragging(false)
  }, [])

  const closeDrawer = useCallback(() => {
    setActiveDrawer(null)
    setDraggingDrawer(null)
    setDragOffset(0)
    setIsDragging(false)
  }, [])

  const toggleDrawer = useCallback((drawer: 'left' | 'right' | 'bottom') => {
    setActiveDrawer((current) => (current === drawer ? null : drawer))
    setDraggingDrawer(null)
    setDragOffset(0)
    setIsDragging(false)
  }, [])

  const startDrag = (
    drawer: 'left' | 'right' | 'bottom',
    isClosing: boolean,
    event: React.PointerEvent
  ) => {
    if (!isMobile) return
    const target = event.currentTarget as HTMLElement
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Fallback if pointer capture is not supported
    }

    const drawerWidth = Math.min(window.innerWidth * 0.88, 360)
    const drawerHeight = Math.min(window.innerHeight * 0.65, 380)
    const maxDimension = drawer === 'bottom' ? drawerHeight : drawerWidth

    const now = performance.now()
    const coord = drawer === 'bottom' ? event.clientY : event.clientX

    dragSession.current = {
      drawer,
      isClosing,
      startX: event.clientX,
      startY: event.clientY,
      startTime: now,
      lastCoord: coord,
      lastTime: now,
      velocity: 0,
      targetElement: target,
      pointerId: event.pointerId,
      maxDimension,
    }

    setDraggingDrawer(drawer)
    setDragOffset(isClosing ? 0 : -maxDimension)
    setIsDragging(true)
  }

  const handleEdgePointerDown = (drawer: 'left' | 'right' | 'bottom', event: React.PointerEvent) => {
    startDrag(drawer, false, event)
  }

  const handleDrawerPointerDown = (drawer: 'left' | 'right' | 'bottom', event: React.PointerEvent) => {
    // Only trigger if starting on handle or header
    startDrag(drawer, true, event)
  }

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const session = dragSession.current
      if (!session || event.pointerId !== session.pointerId) return

      const now = performance.now()
      const dt = Math.max(1, now - session.lastTime)
      const currentCoord = session.drawer === 'bottom' ? event.clientY : event.clientX
      const instantVelocity = (currentCoord - session.lastCoord) / dt
      session.velocity = session.velocity * 0.4 + instantVelocity * 0.6
      session.lastCoord = currentCoord
      session.lastTime = now

      const deltaX = event.clientX - session.startX
      const deltaY = event.clientY - session.startY

      if (session.drawer === 'left') {
        if (session.isClosing) {
          // Dragging left closes (negative deltaX)
          const offset = Math.min(0, Math.max(-session.maxDimension, deltaX))
          setDragOffset(offset)
        } else {
          // Dragging right opens (starts at -maxDimension)
          const offset = Math.min(0, -session.maxDimension + Math.max(0, deltaX))
          setDragOffset(offset)
        }
      } else if (session.drawer === 'right') {
        if (session.isClosing) {
          // Dragging right closes (positive deltaX)
          const offset = Math.max(0, Math.min(session.maxDimension, deltaX))
          setDragOffset(offset)
        } else {
          // Dragging left opens (starts at maxDimension)
          const offset = Math.max(0, session.maxDimension + Math.min(0, deltaX))
          setDragOffset(offset)
        }
      } else if (session.drawer === 'bottom') {
        if (session.isClosing) {
          // Dragging down closes (positive deltaY)
          const offset = Math.max(0, Math.min(session.maxDimension, deltaY))
          setDragOffset(offset)
        } else {
          // Dragging up opens (starts at maxDimension)
          const offset = Math.max(0, session.maxDimension + Math.min(0, deltaY))
          setDragOffset(offset)
        }
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      const session = dragSession.current
      if (!session || event.pointerId !== session.pointerId) return

      if (session.targetElement) {
        try {
          session.targetElement.releasePointerCapture(event.pointerId)
        } catch {
          // Ignore
        }
      }

      const { drawer, isClosing, maxDimension, velocity } = session
      const deltaX = event.clientX - session.startX
      const deltaY = event.clientY - session.startY

      let shouldOpen = false

      if (drawer === 'left') {
        if (isClosing) {
          // Dragged left to close
          const movedLeft = -deltaX
          const flickLeft = velocity < -FLICK_VELOCITY_THRESHOLD
          shouldOpen = !(movedLeft > maxDimension * EDGE_SNAP_THRESHOLD || flickLeft)
        } else {
          // Dragged right to open
          const movedRight = deltaX
          const flickRight = velocity > FLICK_VELOCITY_THRESHOLD
          shouldOpen = movedRight > maxDimension * EDGE_SNAP_THRESHOLD || flickRight
        }
      } else if (drawer === 'right') {
        if (isClosing) {
          // Dragged right to close
          const movedRight = deltaX
          const flickRight = velocity > FLICK_VELOCITY_THRESHOLD
          shouldOpen = !(movedRight > maxDimension * EDGE_SNAP_THRESHOLD || flickRight)
        } else {
          // Dragged left to open
          const movedLeft = -deltaX
          const flickLeft = velocity < -FLICK_VELOCITY_THRESHOLD
          shouldOpen = movedLeft > maxDimension * EDGE_SNAP_THRESHOLD || flickLeft
        }
      } else if (drawer === 'bottom') {
        if (isClosing) {
          // Dragged down to close
          const movedDown = deltaY
          const flickDown = velocity > FLICK_VELOCITY_THRESHOLD
          shouldOpen = !(movedDown > maxDimension * EDGE_SNAP_THRESHOLD || flickDown)
        } else {
          // Dragged up to open
          const movedUp = -deltaY
          const flickUp = velocity < -FLICK_VELOCITY_THRESHOLD
          shouldOpen = movedUp > maxDimension * EDGE_SNAP_THRESHOLD || flickUp
        }
      }

      dragSession.current = null
      setIsDragging(false)
      setDraggingDrawer(null)
      setDragOffset(0)
      setActiveDrawer(shouldOpen ? drawer : null)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  const getDrawerStyle = (drawer: 'left' | 'right' | 'bottom'): React.CSSProperties => {
    if (!isMobile) return {}

    const isCurrentActive = activeDrawer === drawer
    const isCurrentDragging = draggingDrawer === drawer

    if (isCurrentDragging) {
      if (drawer === 'left') {
        return {
          transform: `translateX(${dragOffset}px)`,
          transition: 'none',
        }
      } else if (drawer === 'right') {
        return {
          transform: `translateX(${dragOffset}px)`,
          transition: 'none',
        }
      } else if (drawer === 'bottom') {
        return {
          transform: `translateY(${dragOffset}px)`,
          transition: 'none',
        }
      }
    }

    if (isCurrentActive) {
      if (drawer === 'left' || drawer === 'right') {
        return { transform: 'translateX(0)' }
      }
      return { transform: 'translateY(0)' }
    }

    // Default closed position
    if (drawer === 'left') return { transform: 'translateX(-100%)' }
    if (drawer === 'right') return { transform: 'translateX(100%)' }
    return { transform: 'translateY(100%)' }
  }

  return {
    activeDrawer,
    draggingDrawer,
    dragOffset,
    isDragging,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    handleEdgePointerDown,
    handleDrawerPointerDown,
    getDrawerStyle,
    isMobile,
  }
}

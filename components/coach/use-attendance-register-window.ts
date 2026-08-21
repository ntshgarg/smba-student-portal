"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type AttendanceRegisterWindow = {
  end: number
  start: number
}

const DEFAULT_DATE_WIDTH = 58
const DEFAULT_NAME_WIDTH = 250
const INITIAL_VISIBLE_DATE_COUNT = 8
const OVERSCAN_DATE_COUNT = 4
const TODAY_ALIGNMENT_OFFSET = 280

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function getInitialAttendanceRegisterWindow(
  dateCount: number,
  anchorIndex: number,
): AttendanceRegisterWindow {
  const safeAnchor = clamp(anchorIndex, 0, Math.max(0, dateCount - 1))

  return {
    start: Math.max(0, safeAnchor - OVERSCAN_DATE_COUNT),
    end: Math.min(
      dateCount,
      safeAnchor + INITIAL_VISIBLE_DATE_COUNT + OVERSCAN_DATE_COUNT,
    ),
  }
}

export function getAttendanceRegisterWindow({
  dateCount,
  dateWidth,
  nameWidth,
  scrollLeft,
  viewportWidth,
}: {
  dateCount: number
  dateWidth: number
  nameWidth: number
  scrollLeft: number
  viewportWidth: number
}): AttendanceRegisterWindow {
  if (!dateCount) return { start: 0, end: 0 }

  const safeDateWidth = Math.max(1, dateWidth)
  const firstVisible = clamp(
    Math.floor(Math.max(0, scrollLeft) / safeDateWidth),
    0,
    dateCount - 1,
  )
  const visibleDateCount = Math.max(
    1,
    Math.ceil(Math.max(safeDateWidth, viewportWidth - nameWidth) / safeDateWidth) + 1,
  )

  return {
    start: Math.max(0, firstVisible - OVERSCAN_DATE_COUNT),
    end: Math.min(dateCount, firstVisible + visibleDateCount + OVERSCAN_DATE_COUNT),
  }
}

export function getAttendanceRegisterScrollLeft({
  dateCount,
  dateWidth,
  index,
  nameWidth,
}: {
  dateCount: number
  dateWidth: number
  index: number
  nameWidth: number
}) {
  const safeDateWidth = Math.max(1, dateWidth)
  const targetIndex = clamp(index, 0, Math.max(0, dateCount - 1))
  const visibleColumnsBeforeTarget = Math.max(
    0,
    Math.round(Math.max(0, TODAY_ALIGNMENT_OFFSET - nameWidth) / safeDateWidth),
  )

  return Math.max(0, (targetIndex - visibleColumnsBeforeTarget) * safeDateWidth)
}

function sameWindow(first: AttendanceRegisterWindow, second: AttendanceRegisterWindow) {
  return first.start === second.start && first.end === second.end
}

function readTableDimensions(container: HTMLDivElement) {
  const table = container.querySelector<HTMLElement>("table")
  if (!table) {
    return { dateWidth: DEFAULT_DATE_WIDTH, nameWidth: DEFAULT_NAME_WIDTH }
  }

  const styles = window.getComputedStyle(table)
  return {
    dateWidth: Number.parseFloat(styles.getPropertyValue("--register-date-width"))
      || DEFAULT_DATE_WIDTH,
    nameWidth: Number.parseFloat(styles.getPropertyValue("--register-name-width"))
      || DEFAULT_NAME_WIDTH,
  }
}

export function useAttendanceRegisterWindow({
  dateCount,
  initialIndex,
  resetKey,
  scrollOnReset = true,
}: {
  dateCount: number
  initialIndex: number
  resetKey: string
  scrollOnReset?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [visibleWindow, setVisibleWindow] = useState(() => (
    getInitialAttendanceRegisterWindow(dateCount, initialIndex)
  ))

  const updateWindow = useCallback((scrollLeft?: number) => {
    const container = containerRef.current
    if (!container) return
    const dimensions = readTableDimensions(container)
    const nextWindow = getAttendanceRegisterWindow({
      dateCount,
      ...dimensions,
      scrollLeft: scrollLeft ?? container.scrollLeft,
      viewportWidth: container.clientWidth,
    })
    setVisibleWindow((current) => sameWindow(current, nextWindow) ? current : nextWindow)
  }, [dateCount])

  const onScroll = useCallback(() => {
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      updateWindow()
    })
  }, [updateWindow])

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior) => {
    const container = containerRef.current
    if (!container) return
    const dimensions = readTableDimensions(container)
    const left = getAttendanceRegisterScrollLeft({
      dateCount,
      ...dimensions,
      index,
    })
    updateWindow(left)
    container.scrollTo({ left, behavior })
  }, [dateCount, updateWindow])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (scrollOnReset) scrollToIndex(initialIndex, "auto")
      else updateWindow()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [dateCount, initialIndex, resetKey, scrollOnReset, scrollToIndex, updateWindow])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => updateWindow())
    observer.observe(container)
    return () => observer.disconnect()
  }, [updateWindow])

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  return {
    containerRef,
    onScroll,
    scrollToIndex,
    visibleWindow,
  }
}

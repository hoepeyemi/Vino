'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedCounterProps {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  duration?: number // milliseconds
  className?: string
}

export function AnimatedCounter({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  duration = 2000,
  className,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const [hasAnimated, setHasAnimated] = useState(false)
  const elementRef = useRef<HTMLSpanElement>(null)

  // Declared before the effect that calls it so the reference is stable.
  const animateValue = useCallback((endValue: number) => {
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Cubic easing: 1 - (1 - t)³
      const easedProgress = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(endValue * easedProgress)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        setDisplayValue(endValue)
      }
    }

    requestAnimationFrame(animate)
  }, [duration])

  useEffect(() => {
    const element = elementRef.current
    if (!element || hasAnimated) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated) {
            animateValue(value)
            setHasAnimated(true)
          }
        })
      },
      { threshold: 0.1 }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [value, hasAnimated, animateValue])

  const formattedValue = displayValue.toFixed(decimals)

  return (
    <span ref={elementRef} className={cn('tabular-nums', className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  )
}

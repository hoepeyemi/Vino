'use client'

import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  // Start as null so server and client both render nothing until mounted,
  // avoiding the hydration mismatch when localStorage differs from default.
  const [isDark, setIsDark] = useState<boolean | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('vino-theme')
    const dark = stored !== 'light'
    setIsDark(dark)
    if (!dark) document.documentElement.classList.add('light-mode')
  }, [])

  const toggle = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)

    if (newIsDark) {
      document.documentElement.classList.remove('light-mode')
      localStorage.setItem('vino-theme', 'dark')
    } else {
      document.documentElement.classList.add('light-mode')
      localStorage.setItem('vino-theme', 'light')
    }
  }

  // Render nothing until mounted so server HTML matches client initial render
  if (isDark === null) return <div className="w-8 h-8" />

  return (
    <button
      onClick={toggle}
      className="p-2 rounded hover:bg-[#1a1a1a] light-mode:hover:bg-[#e5e5e5] transition-colors"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-[#666666]" />
      ) : (
        <Moon className="w-4 h-4 text-[#666666]" />
      )}
    </button>
  )
}

import { useId, useRef, useState } from 'react'
import { airportInfo, suggestAirports } from '../lib/airports.js'

/**
 * Chips + autosuggest input for a list of IATA airport/city codes.
 * Suggestions come from a built-in catalog; unknown 3-letter codes are still
 * accepted (the catalog is not exhaustive).
 */
export function AirportInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const suggestions = open ? suggestAirports(text, value) : []

  const add = (code: string) => {
    const c = code.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(c) || value.includes(c)) return
    onChange([...value, c])
    setText('')
    setHighlight(0)
  }

  const remove = (code: string) => onChange(value.filter((v) => v !== code))

  const commitCurrent = () => {
    if (suggestions.length > 0) add(suggestions[Math.min(highlight, suggestions.length - 1)]!.code)
    else if (text.trim()) add(text)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitCurrent()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      remove(value[value.length - 1]!)
    }
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded border border-line bg-white px-2 py-1.5 focus-within:outline-2 focus-within:outline-jade"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((code) => {
          const info = airportInfo(code)
          return (
            <span
              key={code}
              title={info ? `${info.city} — ${info.name}` : 'Unknown airport code (still searched)'}
              className="flex items-center gap-1 rounded-sm bg-board px-1.5 py-0.5 text-white"
            >
              <span className="font-mono text-xs font-semibold">{code}</span>
              {info && <span className="text-[10px] text-white/60">{info.city}</span>}
              <button
                type="button"
                aria-label={`Remove ${code}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(code)
                }}
                className="ml-0.5 rounded px-0.5 text-white/60 hover:bg-white/20 hover:text-white"
              >
                ×
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="min-w-[90px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          value={text}
          placeholder={value.length === 0 ? (placeholder ?? 'type a city or code…') : ''}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setHighlight(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a click on a suggestion lands before the list closes.
            setTimeout(() => {
              setOpen(false)
              if (text.trim()) commitCurrent()
            }, 150)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-line bg-white shadow-lg"
        >
          {suggestions.map((a, i) => (
            <li key={a.code} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                className={`flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-chart' : 'hover:bg-chart'
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault() // keep focus in the input
                  add(a.code)
                }}
              >
                <span className="w-10 font-mono text-xs font-semibold">{a.code}</span>
                <span>{a.city}</span>
                <span className="text-xs text-ink-faint">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

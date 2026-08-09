import type { ComponentChildren } from 'preact'
import { t } from '../i18n'

// Ei komponenttikirjastoa (docs/IMPLEMENTATION_PLAN.md, UI-linjaus 1). Nämä ovat
// ne muutamat palikat, joita sivut tarvitsevat. Kaikki kosketuskohteet >= 44 px.

interface StepperProps {
  label: string
  /** Arvo ja rajat samassa yksikössä kuin `step`. */
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (value: number) => void
  format?: (value: number) => string
}

/**
 * Numerosyöttö +/- steppereinä, ei pienenä tekstikenttänä (UI-linjaus 3).
 * Arvo pysyy aina rajojen sisällä, joten sivut eivät voi tuottaa kelvotonta tilaa.
 */
export function Stepper({ label, value, min, max, step, unit, onChange, format }: StepperProps) {
  const set = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next / step) * step)))
  return (
    <div class="stepper">
      <span class="stepper-label">{label}</span>
      <div class="stepper-controls">
        <button
          type="button"
          class="stepper-button"
          onClick={() => set(value - step)}
          disabled={value <= min}
          aria-label={t('common.decrease', { label })}
        >
          −
        </button>
        <output class="stepper-value">
          {format ? format(value) : value}
          {unit ? <span class="stepper-unit">{unit}</span> : null}
        </output>
        <button
          type="button"
          class="stepper-button"
          onClick={() => set(value + step)}
          disabled={value >= max}
          aria-label={t('common.increase', { label })}
        >
          +
        </button>
      </div>
    </div>
  )
}

interface ToggleProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Toggle({ label, hint, checked, onChange }: ToggleProps) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span class="toggle-text">
        <span class="toggle-label">{label}</span>
        {hint ? <span class="toggle-hint">{hint}</span> : null}
      </span>
    </label>
  )
}

interface ChoiceProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

export function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <div class="choice" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          class={option.value === value ? 'choice-button active' : 'choice-button'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <section class="card">
      {title ? <h2 class="card-title">{title}</h2> : null}
      {children}
    </section>
  )
}

export function Page({ children }: { children: ComponentChildren }) {
  return <div class="page">{children}</div>
}

/** Alapalkki peukalon ulottuvilla (UI-linjaus 2). */
export function ActionBar({ children }: { children: ComponentChildren }) {
  return (
    <div class="action-bar" role="toolbar" aria-label={t('toolbar.label')}>
      {children}
    </div>
  )
}

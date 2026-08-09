import { getLanguage } from './index'

// i18n-sääntö 4: yksiköt ja luvut formatoidaan Intl-perusteisesti lokaalin mukaan.

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLanguage(), options).format(value)
}

/** Millimetrit senttimetreinä, ilman turhia desimaaleja. */
export function formatCm(millimetres: number): string {
  return formatNumber(millimetres / 10, { maximumFractionDigits: 0 })
}

/** Millimetrit metreinä yhdellä desimaalilla — radan pituudelle. */
export function formatMetres(millimetres: number): string {
  return formatNumber(millimetres / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function formatPercent(value: number): string {
  return formatNumber(value / 100, { style: 'percent', maximumFractionDigits: 0 })
}

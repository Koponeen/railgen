import { exportTrackCss } from './trackStyles'

// PNG on vain vientimuoto; totuuden lähde on SVG geometriadatasta (CLAUDE.md).
// Vienti kloonaa kartan, poistaa ele-transformin ja upottaa tyylit, koska
// irrallinen SVG ei näe sovelluksen tyylitiedostoa.

const SVG_NS = 'http://www.w3.org/2000/svg'

export function buildStandaloneSvg(source: SVGSVGElement, widthMm: number, depthMm: number): string {
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('viewBox', `0 0 ${widthMm} ${depthMm}`)
  clone.setAttribute('width', String(widthMm))
  clone.setAttribute('height', String(depthMm))
  clone.removeAttribute('id')

  // Pan/zoom ja ruudulle sovitettu pyöritys ovat katselutilaa, eivät osa kuvaa.
  const world = clone.querySelector('#world')
  if (world instanceof SVGElement) {
    world.style.transform = ''
    world.removeAttribute('id')
  }
  const orient = clone.querySelector('#orient')
  if (orient instanceof SVGElement) {
    orient.removeAttribute('transform')
    orient.removeAttribute('id')
  }
  for (const hit of clone.querySelectorAll('.piece-hit')) hit.remove()
  for (const existing of clone.querySelectorAll('style')) existing.remove()

  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = exportTrackCss()
  clone.insertBefore(style, clone.firstChild)

  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('width', String(widthMm))
  background.setAttribute('height', String(depthMm))
  background.setAttribute('fill', '#ffffff')
  clone.insertBefore(background, style.nextSibling)

  return new XMLSerializer().serializeToString(clone)
}

export interface PngOptions {
  /** Kuvan leveys pikseleinä; korkeus seuraa alueen suhdetta. */
  pixelWidth?: number
  fileName?: string
}

export async function exportTrackPng(
  source: SVGSVGElement,
  widthMm: number,
  depthMm: number,
  options: PngOptions = {},
): Promise<void> {
  const pixelWidth = options.pixelWidth ?? 2000
  const pixelHeight = Math.round((pixelWidth * depthMm) / widthMm)
  const markup = buildStandaloneSvg(source, widthMm, depthMm)
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas 2d context unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    await downloadCanvas(canvas, options.fileName ?? 'rata.png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('failed to rasterise svg'))
    image.src = url
  })
}

function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('failed to encode png'))
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
      resolve()
    }, 'image/png')
  })
}

// Builds <svg><use> icons from the shared/icons.svg sprite without innerHTML.
const NS = 'http://www.w3.org/2000/svg';

export function icon(name: string, className = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  // Resolved from the extension root: pages are bundled, so import.meta.url points at the page script.
  use.setAttribute('href', `${chrome.runtime.getURL('shared/icons.svg')}#${name}`);
  svg.append(use);
  return svg;
}

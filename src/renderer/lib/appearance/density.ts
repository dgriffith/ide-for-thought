export type Density = 'compact' | 'cozy' | 'comfy';

const STORAGE_KEY = 'density';
const DEFAULT_DENSITY: Density = 'cozy';

export function getDensity(): Density {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'compact' || stored === 'cozy' || stored === 'comfy') return stored;
  return DEFAULT_DENSITY;
}

export function setDensity(density: Density): void {
  localStorage.setItem(STORAGE_KEY, density);
  applyDensity(density);
}

export function applyDensity(density: Density): void {
  document.body.setAttribute('data-density', density);
}

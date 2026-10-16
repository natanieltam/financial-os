/**
 * Global light/dark theme (client-side only).
 * The `dark` class on <html> drives the CSS variables in assets/css/main.css.
 * Default is dark (matches the app's original look); the user's choice is
 * persisted in localStorage and applied before paint via the inline script in
 * nuxt.config.ts (no flash of the wrong theme).
 */
export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'finos-theme'

export function useTheme() {
  const mode = useState<ThemeMode>('theme', () => 'dark')

  function apply(next: ThemeMode): void {
    mode.value = next
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', next === 'dark')
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* storage unavailable — theme still applies for this visit */
      }
    }
  }

  function toggle(): void {
    apply(mode.value === 'dark' ? 'light' : 'dark')
  }

  /** Sync state from what the inline script already applied to <html>. */
  function init(): void {
    if (import.meta.client) {
      mode.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    }
  }

  return { mode, toggle, init }
}

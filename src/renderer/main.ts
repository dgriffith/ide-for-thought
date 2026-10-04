// Bundled IBM Plex weights — the CSP blocks external fonts, so ship locally.
// Sans uses the variable font so any weight (incl. the 450 the spec calls for)
// renders without synthesis.
import '@fontsource/ibm-plex-serif/400.css';
import '@fontsource/ibm-plex-serif/400-italic.css';
import '@fontsource/ibm-plex-serif/500.css';
import '@fontsource/ibm-plex-serif/500-italic.css';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource-variable/ibm-plex-sans/wght-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

import './styles/global.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { installNavigationGuard } from './lib/app/navigation-guard';

// Before mount, so no link or file drop can ever take the window off the
// renderer (#2554).
installNavigationGuard();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;

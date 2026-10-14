import React from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/lora';
import '@fontsource-variable/eb-garamond';
import '@fontsource-variable/jetbrains-mono';
import { createRoot } from 'react-dom/client';
import App from './App';
import Tooltips from './Tooltips';
import './styles.css';
import './refinements.css';
import './workloads.css';
import './appearance.css';
import './workspace.css';
import './update.css';
import './comfort.css';
import './workspace-design.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Tooltips />
  </React.StrictMode>,
);

import './calendar-reports.css';
import './matrix.css';
import './polish.css';
import './settings.css';
import './theme-extensions.css';

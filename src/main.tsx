import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

function render() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Dev-Mock (nur `pnpm dev` + `?mock`): Backend-Simulation für UI-Arbeit
// im Browser — im Release-Bundle nicht enthalten.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) {
  import('./devmock').then(render);
} else {
  render();
}

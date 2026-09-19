import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { preloadSolarScene } from './components/LandingHero';
import './index.css';

/* Kick the 3D hero's chunk off before the first render: it is a separate
   ~900KB chunk (see LandingHero), and starting it here — instead of waiting
   for React to mount the hero — lets it download alongside the entry graph.
   The gate inside keeps phones, reduced-motion users and low-power devices
   from ever requesting it. */
preloadSolarScene();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

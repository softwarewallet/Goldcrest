import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { OperatorSessionGate } from './components/OperatorSessionGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OperatorSessionGate><App /></OperatorSessionGate>
  </StrictMode>,
);

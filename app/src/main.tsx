import './design/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { captureInvite } from './data/inviteLink';
import { mirror } from './data/titlesStore';

// Before anything reads the address: a friend's link is kept for sign-in.
captureInvite(window, mirror);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

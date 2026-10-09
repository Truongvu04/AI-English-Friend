import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ExperienceRoot from './ExperienceRoot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExperienceRoot />
  </StrictMode>,
)

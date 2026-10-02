// Navega in-app (não abre nova aba): o OrthoVis está embarcado no ris-frontend.
import { useNavigate } from 'react-router-dom'

export function useOpenInViewer() {
  const navigate = useNavigate()
  return (studyInstanceUID: string) => {
    navigate(`/viewer/${encodeURIComponent(studyInstanceUID)}`)
  }
}

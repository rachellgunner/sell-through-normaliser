import { useState, type FormEvent, type ReactNode } from 'react'
import { ACCESS_PASSPHRASE, SESSION_STORAGE_KEY } from './config'

function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isUnlocked)
  const [attempt, setAttempt] = useState('')
  const [error, setError] = useState(false)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (attempt === ACCESS_PASSPHRASE) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, 'true')
      } catch {
        // sessionStorage unavailable (e.g. private browsing) — unlock for this render only.
      }
      setUnlocked(true)
      setError(false)
    } else {
      setError(true)
    }
  }

  if (unlocked) return <>{children}</>

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={handleSubmit}>
        <h1>UKLASH Sell-Through Normaliser</h1>
        <p>Enter the access passphrase to continue.</p>
        <input
          type="password"
          autoFocus
          value={attempt}
          onChange={(e) => {
            setAttempt(e.target.value)
            setError(false)
          }}
          placeholder="Passphrase"
        />
        {error && <p className="gate-error">That passphrase isn't right.</p>}
        <button type="submit">Continue</button>
      </form>
    </div>
  )
}

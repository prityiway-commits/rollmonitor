/**
 * hooks/useApi.js
 *
 * Generic hook that calls an async API function, tracks loading/error state,
 * and returns the result.
 *
 * Usage:
 *   const { data, loading, error, refresh } = useApi(fetchStatus, ['5.143.135.82.1.1'])
 */
import { useState, useEffect, useCallback, useRef } from 'react'

export function useApi(apiFn, args = [], options = {}) {
  const { pollMs = null, enabled = true } = options

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const timerRef = useRef(null)
  // Serialise args so the effect dependency is stable
  const argsKey = JSON.stringify(args)

  const run = useCallback(async () => {
    if (!enabled || !apiFn) return
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiFn(...args)
    // Only update data if new data arrived — keep previous on error/null
    if (d !== null && d !== undefined) setData(d)
    setError(e)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFn, argsKey, enabled])

  useEffect(() => {
    run()
    if (pollMs) {
      timerRef.current = setInterval(run, pollMs)
    }
    return () => clearInterval(timerRef.current)
  }, [run, pollMs])

  return { data, loading, error, refresh: run }
}

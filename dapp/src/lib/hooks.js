import { useEffect, useRef, useState } from "react";

/** Ticking clock (unix seconds), for live close / appeal countdowns. */
export function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

/**
 * SWR chain read: `seed` paints instantly when provided; the fetcher runs
 * on mount and whenever deps change. Returns { data, error, loading, refetch }.
 */
export function useChainRead(fetcher, deps, seed = null) {
  const [data, setData] = useState(seed);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!seed);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seedRef = useRef(seed);
  const runId = useRef(0);

  const refetch = async () => {
    const id = ++runId.current;
    try {
      const result = await fetcherRef.current();
      if (runId.current === id) {
        setData(result);
        setError("");
        setLoading(false);
      }
      return result;
    } catch (e) {
      if (runId.current === id) {
        setError(e.message || "The chain read failed.");
        setLoading(false);
      }
      return null;
    }
  };

  useEffect(() => {
    if (seedRef.current != null) setData(seedRef.current);
    setLoading((prev) => (data == null ? true : prev));
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetch };
}

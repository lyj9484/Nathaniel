import { useEffect, useState, useCallback } from "react";
import * as H from "./db/holdings.js";
import * as T from "./db/transactions.js";
import * as S from "./db/userSettings.js";

export function useHoldings() {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const data = await H.listHoldings();
      setHoldings(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (h) => {
    const created = await H.addHolding(h);
    setHoldings((prev) => [...prev, created]);
    return created;
  }, []);

  const remove = useCallback(async (id) => {
    await H.removeHolding(id);
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }, []);

  return { holdings, loading, error, add, remove, reload };
}

export function useTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const data = await T.listTransactions();
      setTransactions(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (t) => {
    const created = await T.addTransaction(t);
    setTransactions((prev) => [created, ...prev]);
    return created;
  }, []);

  const update = useCallback(async (id, patch) => {
    const updated = await T.updateTransaction(id, patch);
    setTransactions((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);

  const remove = useCallback(async (id) => {
    await T.deleteTransaction(id);
    setTransactions((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { transactions, loading, error, add, update, remove, reload };
}

export function useSettings() {
  const [target, setTarget] = useState(S.DEFAULTS.target);
  const [fxRate, setFxRate] = useState(S.DEFAULTS.fxRate);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    S.getSettings().then(({ target, fxRate }) => {
      setTarget(target);
      setFxRate(fxRate);
    }).finally(() => setLoading(false));
  }, []);

  async function saveTarget(t) {
    const next = await S.updateTarget(t);
    setTarget(next);
  }
  async function saveFxRate(r) {
    const next = await S.updateFxRate(r);
    setFxRate(next);
  }
  return { target, fxRate, loading, saveTarget, saveFxRate };
}

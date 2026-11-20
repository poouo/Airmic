import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * 简单的异步数据加载 hook：deps 变化或调用 reload() 时重新执行 loader。
 * 组件卸载/依赖变化后丢弃过期结果。
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncDataState<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(errorMessage(caught));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { data, loading, error, reload };
}

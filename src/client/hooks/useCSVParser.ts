import { useState, useCallback } from 'react';
import { parseCSV, parseBatchCSV, type CSVParseResult, type BatchCSVRow } from '../utils/csvUtils';

export function useCSVParser<T = Record<string, string>>() {
  const [result, setResult] = useState<CSVParseResult<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseFile = useCallback(async (file: File): Promise<CSVParseResult<T>> => {
    setLoading(true);
    setError(null);

    try {
      const text = await file.text();
      const parsed = parseCSV<T>(text);
      setResult(parsed);

      if (parsed.errors.length > 0) {
        setError(parsed.errors.join('; '));
      }

      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse CSV';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const parseText = useCallback((text: string): CSVParseResult<T> => {
    const parsed = parseCSV<T>(text);
    setResult(parsed);

    if (parsed.errors.length > 0) {
      setError(parsed.errors.join('; '));
    }

    return parsed;
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    loading,
    error,
    parseFile,
    parseText,
    reset,
  };
}

export function useBatchCSVParser() {
  const [result, setResult] = useState<CSVParseResult<BatchCSVRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseFile = useCallback(async (file: File): Promise<CSVParseResult<BatchCSVRow>> => {
    setLoading(true);
    setError(null);

    try {
      const text = await file.text();
      const parsed = parseBatchCSV(text);
      setResult(parsed);

      if (parsed.errors.length > 0) {
        setError(parsed.errors.join('; '));
      }

      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse CSV';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    loading,
    error,
    parseFile,
    reset,
    rows: result?.rows || [],
    headers: result?.headers || [],
  };
}

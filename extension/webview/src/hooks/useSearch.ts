import { useState, useCallback } from 'react';
import { useVSCode } from './useVSCode';

export interface SearchResult {
  usr: string;
  name: string;
  file: string;
  line: number;
  module: string;
  type?: string;
}

export function useSearch() {
  const { postMessage } = useVSCode();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState<'function' | 'variable'>('function');

  const search = useCallback((query: string, type: 'function' | 'variable') => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    setSearchType(type);

    postMessage({
      type: type === 'function' ? 'searchFunction' : 'searchVariable',
      query,
    });
  }, [postMessage]);

  const handleResults = useCallback((data: SearchResult[]) => {
    setResults(data);
    setLoading(false);
  }, []);

  return { results, loading, searchType, search, handleResults, setResults };
}

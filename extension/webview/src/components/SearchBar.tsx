import React, { useState, useCallback } from 'react';

interface SearchBarProps {
  onSearch: (query: string, type: 'function' | 'variable') => void;
  loading: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, loading }) => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'function' | 'variable'>('function');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query, searchType);
    }
  }, [query, searchType, onSearch]);

  return (
    <div className="search-bar">
      <form onSubmit={handleSubmit} className="search-form">
        <div className="search-type-toggle">
          <button
            type="button"
            className={`toggle-btn ${searchType === 'function' ? 'active' : ''}`}
            onClick={() => setSearchType('function')}
          >
            函数
          </button>
          <button
            type="button"
            className={`toggle-btn ${searchType === 'variable' ? 'active' : ''}`}
            onClick={() => setSearchType('variable')}
          >
            变量
          </button>
        </div>
        <div className="search-input-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchType === 'function' ? '搜索函数名...' : '搜索全局变量名...'}
            className="search-input"
          />
          <button type="submit" className="search-btn" disabled={loading || !query.trim()}>
            {loading ? '...' : '搜索'}
          </button>
        </div>
      </form>
    </div>
  );
};

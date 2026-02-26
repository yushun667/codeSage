import React, { useState, useCallback } from 'react';

interface SearchBarProps {
  onSearch: (query: string, type: 'function' | 'variable') => void;
  onFindPath: (fromUsr: string, toUsr: string) => void;
  loading: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, onFindPath, loading }) => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'function' | 'variable'>('function');
  const [pathMode, setPathMode] = useState(false);
  const [fromUsr, setFromUsr] = useState('');
  const [toUsr, setToUsr] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (pathMode) {
      if (fromUsr.trim() && toUsr.trim()) {
        onFindPath(fromUsr.trim(), toUsr.trim());
      }
    } else if (query.trim()) {
      onSearch(query, searchType);
    }
  }, [query, searchType, pathMode, fromUsr, toUsr, onSearch, onFindPath]);

  return (
    <div className="search-bar">
      <form onSubmit={handleSubmit} className="search-form">
        <div className="search-type-toggle">
          <button
            type="button"
            className={`toggle-btn ${!pathMode && searchType === 'function' ? 'active' : ''}`}
            onClick={() => { setSearchType('function'); setPathMode(false); }}
          >
            函数
          </button>
          <button
            type="button"
            className={`toggle-btn ${!pathMode && searchType === 'variable' ? 'active' : ''}`}
            onClick={() => { setSearchType('variable'); setPathMode(false); }}
          >
            变量
          </button>
          <button
            type="button"
            className={`toggle-btn ${pathMode ? 'active' : ''}`}
            onClick={() => setPathMode(true)}
          >
            路径
          </button>
        </div>
        {pathMode ? (
          <div className="path-inputs">
            <input
              type="text"
              value={fromUsr}
              onChange={(e) => setFromUsr(e.target.value)}
              placeholder="起始函数 USR..."
              className="search-input"
            />
            <input
              type="text"
              value={toUsr}
              onChange={(e) => setToUsr(e.target.value)}
              placeholder="目标函数 USR..."
              className="search-input"
            />
            <button type="submit" className="search-btn" disabled={loading || !fromUsr.trim() || !toUsr.trim()}>
              {loading ? '...' : '查找路径'}
            </button>
          </div>
        ) : (
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
        )}
      </form>
    </div>
  );
};

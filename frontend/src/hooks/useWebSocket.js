import { useState, useEffect, useRef, useCallback } from 'react';

const MAX_LOGS = 500;

export function useWebSocket(url) {
  const [lastMessage,  setLastMessage]  = useState(null);
  const [prices,       setPrices]       = useState({});
  const [positions,    setPositions]    = useState([]);
  const [signals,      setSignals]      = useState([]);
  const [anthropicAnalysis, setAnthropicAnalysis] = useState(null);
  const [accountMode,  setAccountMode]  = useState(null);
  const [resting,      setResting]      = useState(null); // { resting, openTrades, maxOpenTrades }
  const [balance,      setBalance]      = useState(null);
  const [logs,         setLogs]         = useState([]);
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    if (!url) return; // wait until we have a token (or a real URL) to connect with
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          setLastMessage(msg);
          if (msg.type === 'prices')        setPrices(msg.prices);
          if (msg.type === 'positions')     setPositions(msg.positions || []);
          if (msg.type === 'signals')       setSignals(msg.signals || []);
          if (msg.type === 'anthropic_analysis') setAnthropicAnalysis(msg);
          if (msg.type === 'account_mode')  setAccountMode(msg);
          if (msg.type === 'bot_resting')   setResting(msg);
          if (msg.type === 'balance')       setBalance(msg.balance);
          if (msg.type === 'log')           setLogs(prev => [...prev, { time: msg.time, level: msg.level, message: msg.message }].slice(-MAX_LOGS));
        } catch {}
      };
      ws.onclose = () => setTimeout(connect, 3000);
      ws.onerror = () => ws.close();
    } catch {}
  }, [url]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { lastMessage, prices, positions, signals, anthropicAnalysis, accountMode, resting, balance, logs };
}

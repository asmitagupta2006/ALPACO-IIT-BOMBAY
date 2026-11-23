import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, KeyRound, RefreshCw, WifiOff } from 'lucide-react';
import {
  AlpacaClientRequestError,
  fetchAlpacaBars,
  fetchAlpacaHealth,
  fetchAlpacaSymbols,
} from './api/alpacaApi';
import {
  fetchCandles,
  fetchDeltaRegime,
  fetchHealth,
  fetchProducts,
  fetchTicker,
  subscribeDeltaStream,
} from './api/deltaApi';
import {
  acknowledgeAlert,
  fetchAlerts,
  fetchSentinelOverview,
  resumeStrategies,
  triggerKillSwitch,
  updateGuardrailConfig,
} from './api/sentinelApi';
import {
  CandleChartPanel,
  LOOKBACK_OPTIONS,
} from './components/CandleChartPanel';
import { ContractSpecsPanel } from './components/ContractSpecsPanel';
import { DecisionLogPanel } from './components/DecisionLogPanel';
import { GuardrailAlertFeed } from './components/GuardrailAlertFeed';
import { GuardrailRulesPanel } from './components/GuardrailRulesPanel';
import { InstrumentPicker } from './components/InstrumentPicker';
import { LiveTickerStrip } from './components/LiveTickerStrip';
import { PhaseRoadmapStrip } from './components/PhaseRoadmapStrip';
import { RegimeCard } from './components/RegimeCard';
import { TopBar } from './components/TopBar';
import {
  AuditHistoryPanel,
  SystemHealthPanel,
} from './components/sentinel/AuditAndHealthPanels';
import { CompetitionDeckPanel } from './components/sentinel/CompetitionDeckPanel';
import { ExplainabilityPanel } from './components/sentinel/ExplainabilityPanel';
import { GuardrailCenterPanel } from './components/sentinel/GuardrailCenterPanel';
import {
  OverviewDashboard,
  type NavSectionId,
} from './components/sentinel/OverviewDashboard';
import { PaperSimulatorPanel } from './components/sentinel/PaperSimulatorPanel';
import { RegimeEnginePanel } from './components/sentinel/RegimeEnginePanel';
import { RiskPredictionPanel } from './components/sentinel/RiskPredictionPanel';
import { StrategyHealthPanel } from './components/sentinel/StrategyHealthPanel';
import { TrainingCenterPanel } from './components/sentinel/TrainingCenterPanel';
import { WorkspaceSidebar } from './components/sentinel/WorkspaceSidebar';
import {
  formatDataModeLabel,
  regimeBadgeClass,
} from './components/sentinel/uiHelpers';
import type {
  AlpacaFeedInfo,
  AlpacaHealthResponse,
  AlpacaStockFeed,
  AlpacaSymbolSummary,
  MarketDataSource,
} from './contracts/alpaca';
import type {
  CandlePriceBasis,
  CandleResolution,
  DeltaCandle,
  DeltaProductSummary,
  DeltaTickerSnapshot,
  DeltaWsConnectionState,
  HealthStatusResponse,
} from './contracts/delta';
import type { Phase2RegimeResponse } from './contracts/regime';
import type {
  AlertDecision,
  FirestoreDecisionRecord,
  GuardrailAlert,
  GuardrailRule,
} from './contracts/guardrails';
import type {
  GuardrailConfig,
  RegimeTransitionAlert,
  SentinelOverviewResponse,
} from './contracts/sentinel';
import {
  formatFirestoreErrorMessage,
  signInWithGoogle,
  signOutFromGoogle,
  subscribeToAuthState,
} from './firebase';
import {
  evaluateGuardrailRules,
  reconcileAlertFeed,
  validateCooldownSeconds,
  validateGuardrailRule,
} from './guardrails/engine';
import {
  fetchUserDecisionsOnce,
  saveGuardrailDecisionToFirestore,
  subscribeToUserDecisions,
} from './services/decisionLogService';
import { formatTimestamp } from './utils/format';

interface ErrorState {
  message: string;
  timestamp: string;
}

const SENTINEL_RESOLUTIONS: readonly CandleResolution[] = ['5m', '15m', '1h', '4h'];
const USER_RULES_STORAGE_KEY = 'regime_sentinel_phase3_rules_v1';
const USER_COOLDOWN_STORAGE_KEY = 'regime_sentinel_phase3_cooldown_v1';

function loadStoredUserRules(): GuardrailRule[] {
  try {
    const raw = window.localStorage.getItem(USER_RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is GuardrailRule =>
        typeof r === 'object' &&
        r !== null &&
        typeof r.id === 'string' &&
        validateGuardrailRule(r).valid,
    );
  } catch {
    return [];
  }
}

function loadStoredCooldown(): number {
  try {
    const raw = window.localStorage.getItem(USER_COOLDOWN_STORAGE_KEY);
    if (!raw) return 300;
    const num = Number(raw);
    return validateCooldownSeconds(num).valid ? num : 300;
  } catch {
    return 300;
  }
}

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Health telemetry
  const [health, setHealth] = useState<HealthStatusResponse | null>(null);
  const [wsStateOverride, setWsStateOverride] = useState<DeltaWsConnectionState | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // Live products catalog
  const [products, setProducts] = useState<DeltaProductSummary[]>([]);
  const [underlyings, setUnderlyings] = useState<string[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<ErrorState | null>(null);
  const [productsSource, setProductsSource] = useState<string | null>(null);
  const [productsFetchedAt, setProductsFetchedAt] = useState<string | null>(null);

  // Selected instrument & chart parameters
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>('BTCUSD');
  const [resolution, setResolution] = useState<CandleResolution>('15m');
  const [lookbackId, setLookbackId] = useState<string>('24h');
  const [basis, setBasis] = useState<CandlePriceBasis>('trade');

  // Live ticker state
  const [ticker, setTicker] = useState<DeltaTickerSnapshot | null>(null);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [tickerError, setTickerError] = useState<ErrorState | null>(null);
  const [tickerSource, setTickerSource] = useState<string | null>(null);
  const [tickerUpdatedAt, setTickerUpdatedAt] = useState<string | null>(null);

  // Historical + live candle state
  const [candles, setCandles] = useState<DeltaCandle[]>([]);
  const [liveCandle, setLiveCandle] = useState<DeltaCandle | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [candlesError, setCandlesError] = useState<ErrorState | null>(null);
  const [candlesSource, setCandlesSource] = useState<string | null>(null);
  const [candlesFetchedAt, setCandlesFetchedAt] = useState<string | null>(null);
  const [candlesQuerySymbol, setCandlesQuerySymbol] = useState<string | null>(null);

  // Phase 2: Causal Market Regime Detection state
  const [phase2Regime, setPhase2Regime] = useState<Phase2RegimeResponse | null>(null);
  const [phase2RegimeLoading, setPhase2RegimeLoading] = useState(false);
  const [phase2RegimeError, setPhase2RegimeError] = useState<ErrorState | null>(null);
  const [phase2RegimeFetchedAt, setPhase2RegimeFetchedAt] = useState<string | null>(null);

  // Phase 3: Deterministic Guardrail Rule Engine, Approval Feed, Google Auth & Firestore Decision Log
  const [guardrailRules, setGuardrailRules] = useState<GuardrailRule[]>(loadStoredUserRules);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(loadStoredCooldown);
  const [guardrailAlerts, setGuardrailAlerts] = useState<GuardrailAlert[]>([]);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [decisionRecords, setDecisionRecords] = useState<FirestoreDecisionRecord[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState<boolean>(false);
  const [decisionsError, setDecisionsError] = useState<ErrorState | null>(null);
  const [decisionsLastUpdated, setDecisionsLastUpdated] = useState<string | null>(null);

  // Optional Alpaca read-only Market Data state (Step 1: client + bars chart)
  const [marketSource, setMarketSource] = useState<MarketDataSource>('delta');
  const [alpacaHealth, setAlpacaHealth] = useState<AlpacaHealthResponse | null>(null);
  const [alpacaCheckingHealth, setAlpacaCheckingHealth] = useState(false);
  const [alpacaSymbols, setAlpacaSymbols] = useState<AlpacaSymbolSummary[]>([]);
  const [alpacaSymbolsLoading, setAlpacaSymbolsLoading] = useState(false);
  const [alpacaSymbolsError, setAlpacaSymbolsError] = useState<ErrorState | null>(null);
  const [alpacaSymbolsFetchedAt, setAlpacaSymbolsFetchedAt] = useState<string | null>(null);
  const [alpacaSelectedSymbol, setAlpacaSelectedSymbol] = useState<string | null>(null);
  const [alpacaFeed, setAlpacaFeed] = useState<AlpacaStockFeed>('iex');
  const [alpacaFeedInfo, setAlpacaFeedInfo] = useState<AlpacaFeedInfo | null>(null);
  const [alpacaCandles, setAlpacaCandles] = useState<DeltaCandle[]>([]);
  const [alpacaCandlesLoading, setAlpacaCandlesLoading] = useState(false);
  const [alpacaCandlesError, setAlpacaCandlesError] = useState<ErrorState | null>(null);
  const [alpacaCandlesFetchedAt, setAlpacaCandlesFetchedAt] = useState<string | null>(null);

  // Regime Sentinel AI Engine state
  const [analysisSymbol, setAnalysisSymbol] = useState<string>('BTCUSD');
  const [dataMode, setDataMode] = useState<'live' | 'demo'>('live');
  const [overview, setOverview] = useState<SentinelOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState<boolean>(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<RegimeTransitionAlert[]>([]);
  const [explainStrategyId, setExplainStrategyId] = useState<string>('strat-btc-momentum');

  const sentinelResolution: CandleResolution = SENTINEL_RESOLUTIONS.includes(resolution)
    ? resolution
    : '15m';

  const selectedProduct = useMemo(
    () => products.find((p) => p.symbol === selectedSymbol) ?? null,
    [products, selectedSymbol],
  );

  const loadHealth = useCallback(async () => {
    setIsCheckingHealth(true);
    try {
      const h = await fetchHealth();
      setHealth(h);
    } catch {
      setHealth((prev) => ({
        ok: false,
        deltaRestOk: false,
        deltaRestLatencyMs: null,
        deltaWsState: prev?.deltaWsState ?? 'disconnected',
        lastRestSuccessAt: prev?.lastRestSuccessAt ?? null,
        lastWsMessageAt: prev?.lastWsMessageAt ?? null,
        lastError: 'Unable to reach local server /api/health',
        cacheStats: prev?.cacheStats ?? {
          productsCached: false,
          productsAgeMs: null,
          candleCacheEntries: 0,
        },
        checkedAt: new Date().toISOString(),
      }));
    } finally {
      setIsCheckingHealth(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const env = await fetchProducts();
      setProducts(env.data.products);
      setUnderlyings(env.data.underlyings);
      setProductsSource(env.source);
      setProductsFetchedAt(env.fetchedAt);

      setSelectedSymbol((prev) => {
        if (prev && env.data.products.some((p) => p.symbol === prev)) {
          return prev;
        }
        const btcPerp = env.data.products.find(
          (p) => p.symbol === 'BTCUSD' && p.tradingStatus === 'operational',
        );
        const firstPerp = env.data.products.find(
          (p) => p.contractType === 'perpetual_futures' && p.tradingStatus === 'operational',
        );
        return btcPerp?.symbol ?? firstPerp?.symbol ?? env.data.products[0]?.symbol ?? null;
      });
    } catch (err) {
      setProductsError({
        message: err instanceof Error ? err.message : 'Failed to fetch live products',
        timestamp: new Date().toISOString(),
      });
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadTicker = useCallback(async (symbol: string, signal?: AbortSignal) => {
    setTickerLoading(true);
    setTickerError(null);
    try {
      const env = await fetchTicker(symbol, signal);
      setTicker(env.data);
      setTickerSource(env.source);
      setTickerUpdatedAt(env.fetchedAt);
    } catch (err) {
      if (signal?.aborted) return;
      setTickerError({
        message: err instanceof Error ? err.message : 'Failed to load ticker',
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (!signal?.aborted) {
        setTickerLoading(false);
      }
    }
  }, []);

  const loadPhase2Regime = useCallback(
    async (
      symbol: string,
      res: CandleResolution,
      start: number,
      end: number,
      priceBasis: CandlePriceBasis,
      signal?: AbortSignal,
    ) => {
      setPhase2RegimeLoading(true);
      setPhase2RegimeError(null);

      try {
        const env = await fetchDeltaRegime(
          {
            symbol,
            resolution: res,
            start,
            end,
            basis: priceBasis,
          },
          signal,
        );
        if (signal?.aborted) return;
        setPhase2Regime(env.data);
        setPhase2RegimeFetchedAt(env.fetchedAt);
      } catch (err) {
        if (signal?.aborted) return;
        setPhase2Regime(null);
        setPhase2RegimeError({
          message: err instanceof Error ? err.message : 'Failed to compute regime state',
          timestamp: new Date().toISOString(),
        });
      } finally {
        if (!signal?.aborted) {
          setPhase2RegimeLoading(false);
        }
      }
    },
    [],
  );

  const loadCandles = useCallback(
    async (
      symbol: string,
      res: CandleResolution,
      lbId: string,
      priceBasis: CandlePriceBasis,
      signal?: AbortSignal,
    ) => {
      setCandlesLoading(true);
      setCandlesError(null);
      setLiveCandle(null);

      const lookbackSec =
        LOOKBACK_OPTIONS.find((opt) => opt.id === lbId)?.seconds ?? 24 * 3600;
      const end = Math.floor(Date.now() / 1000);
      const start = end - lookbackSec;

      void loadPhase2Regime(symbol, res, start, end, priceBasis, signal);

      try {
        const env = await fetchCandles(
          {
            symbol,
            resolution: res,
            start,
            end,
            basis: priceBasis,
          },
          signal,
        );
        setCandles(env.data.candles);
        setCandlesQuerySymbol(env.data.querySymbol);
        setCandlesSource(env.source);
        setCandlesFetchedAt(env.fetchedAt);
      } catch (err) {
        if (signal?.aborted) return;
        setCandles([]);
        setCandlesError({
          message: err instanceof Error ? err.message : 'Failed to load candles',
          timestamp: new Date().toISOString(),
        });
      } finally {
        if (!signal?.aborted) {
          setCandlesLoading(false);
        }
      }
    },
    [loadPhase2Regime],
  );

  const loadSentinelOverview = useCallback(
    async (sym: string, res: CandleResolution, mode: 'live' | 'demo', signal?: AbortSignal) => {
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        const [ov, alertRes] = await Promise.all([
          fetchSentinelOverview({ symbol: sym, resolution: res, mode, signal }),
          fetchAlerts(),
        ]);
        if (signal?.aborted) return;
        setOverview(ov);
        setAlerts(alertRes.alerts);
      } catch (err) {
        if (signal?.aborted) return;
        setOverviewError(err instanceof Error ? err.message : 'Failed to compute Sentinel telemetry');
      } finally {
        if (!signal?.aborted) {
          setOverviewLoading(false);
        }
      }
    },
    [],
  );

  const loadAlpacaHealth = useCallback(async () => {
    setAlpacaCheckingHealth(true);
    try {
      const h = await fetchAlpacaHealth();
      setAlpacaHealth(h);
    } catch {
      setAlpacaHealth((prev) => ({
        configured: prev?.configured ?? false,
        ok: false,
        status: prev?.configured ? 'error' : 'not_configured',
        latencyMs: null,
        defaultStockFeed: prev?.defaultStockFeed ?? 'iex',
        lastSuccessAt: prev?.lastSuccessAt ?? null,
        lastError: 'Unable to reach local server /api/alpaca/health',
        cacheStats: prev?.cacheStats ?? {
          symbolsCached: false,
          barsCacheEntries: 0,
          latestCacheEntries: 0,
        },
        checkedAt: new Date().toISOString(),
      }));
    } finally {
      setAlpacaCheckingHealth(false);
    }
  }, []);

  const loadAlpacaSymbols = useCallback(async (signal?: AbortSignal) => {
    setAlpacaSymbolsLoading(true);
    setAlpacaSymbolsError(null);
    try {
      const env = await fetchAlpacaSymbols(undefined, signal);
      if (signal?.aborted) return;
      setAlpacaSymbols(env.data.symbols);
      setAlpacaSymbolsFetchedAt(env.fetchedAt);
      setAlpacaSelectedSymbol((prev) => {
        if (prev) return prev;
        return env.data.symbols[0]?.symbol ?? null;
      });
    } catch (err) {
      if (signal?.aborted) return;
      setAlpacaSymbolsError({
        message: err instanceof Error ? err.message : 'Failed to fetch Alpaca symbols',
        timestamp:
          err instanceof AlpacaClientRequestError ? err.timestamp : new Date().toISOString(),
      });
    } finally {
      if (!signal?.aborted) {
        setAlpacaSymbolsLoading(false);
      }
    }
  }, []);

  const loadAlpacaCandles = useCallback(
    async (
      symbol: string,
      res: CandleResolution,
      lbId: string,
      feed: AlpacaStockFeed,
      signal?: AbortSignal,
    ) => {
      setAlpacaCandlesLoading(true);
      setAlpacaCandlesError(null);

      const lookbackSec =
        LOOKBACK_OPTIONS.find((opt) => opt.id === lbId)?.seconds ?? 24 * 3600;
      const end = Math.floor(Date.now() / 1000);
      const start = end - lookbackSec;

      try {
        const env = await fetchAlpacaBars(
          {
            symbol,
            resolution: res,
            start,
            end,
            feed,
          },
          signal,
        );
        if (signal?.aborted) return;
        setAlpacaCandles(env.data.candles);
        setAlpacaFeedInfo(env.data.feedInfo);
        setAlpacaCandlesFetchedAt(env.fetchedAt);
      } catch (err) {
        if (signal?.aborted) return;
        setAlpacaCandles([]);
        setAlpacaCandlesError({
          message: err instanceof Error ? err.message : 'Failed to load Alpaca bars',
          timestamp:
            err instanceof AlpacaClientRequestError ? err.timestamp : new Date().toISOString(),
        });
      } finally {
        if (!signal?.aborted) {
          setAlpacaCandlesLoading(false);
        }
      }
    },
    [],
  );

  // Initial load + 30s health polling
  useEffect(() => {
    void loadHealth();
    void loadAlpacaHealth();
    void loadProducts();
    const timer = setInterval(() => {
      void loadHealth();
      void loadAlpacaHealth();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadHealth, loadAlpacaHealth, loadProducts]);

  // Load Alpaca symbols only when Alpaca is selected AND configured on the server
  useEffect(() => {
    if (marketSource !== 'alpaca' || !alpacaHealth?.configured) return;
    if (alpacaSymbols.length > 0) return;
    const controller = new AbortController();
    void loadAlpacaSymbols(controller.signal);
    return () => controller.abort();
  }, [marketSource, alpacaHealth?.configured, alpacaSymbols.length, loadAlpacaSymbols]);

  // Load Alpaca historical bars when Alpaca source + configured + symbol selected
  useEffect(() => {
    if (marketSource !== 'alpaca' || !alpacaHealth?.configured || !alpacaSelectedSymbol) {
      return;
    }
    const controller = new AbortController();
    void loadAlpacaCandles(
      alpacaSelectedSymbol,
      resolution,
      lookbackId,
      alpacaFeed,
      controller.signal,
    );
    return () => controller.abort();
  }, [
    marketSource,
    alpacaHealth?.configured,
    alpacaSelectedSymbol,
    resolution,
    lookbackId,
    alpacaFeed,
    loadAlpacaCandles,
  ]);

  // Load Sentinel overview & refresh periodically
  useEffect(() => {
    const controller = new AbortController();
    void loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode, controller.signal);
    const timer = setInterval(() => {
      void loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode);
    }, 45_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [analysisSymbol, sentinelResolution, dataMode, loadSentinelOverview]);

  // Reset ticker, candles, and regime cleanly when switching instrument
  const handleSelectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setTicker(null);
    setCandles([]);
    setLiveCandle(null);
    setPhase2Regime(null);
    setPhase2RegimeError(null);
    setBasis('trade');
    if (symbol === 'BTCUSD' || symbol === 'ETHUSD') {
      setAnalysisSymbol(symbol);
    }
  }, []);

  const handleSelectAlpacaSymbol = useCallback((symbol: string) => {
    setAlpacaSelectedSymbol(symbol);
    setAlpacaCandles([]);
    setAlpacaCandlesError(null);
    setAlpacaFeedInfo(null);
  }, []);

  // Load REST ticker + candles and subscribe to server-bridged WebSocket SSE
  useEffect(() => {
    if (!selectedSymbol) return;
    const controller = new AbortController();

    void loadTicker(selectedSymbol, controller.signal);
    void loadCandles(selectedSymbol, resolution, lookbackId, basis, controller.signal);

    const unsubscribe = subscribeDeltaStream({
      symbol: selectedSymbol,
      resolution,
      basis,
      onEvent: (event) => {
        if (event.type === 'health') {
          setWsStateOverride(event.wsState);
        } else if (event.type === 'ticker' && event.symbol === selectedSymbol) {
          setTicker(event.ticker);
          setTickerSource(event.source);
          setTickerUpdatedAt(event.timestamp);
          setTickerError(null);
        } else if (
          event.type === 'candle' &&
          event.symbol === selectedSymbol &&
          event.resolution === resolution &&
          event.basis === basis
        ) {
          setLiveCandle(event.candle);
          setCandlesSource(event.source);
          setCandlesFetchedAt(event.timestamp);
        } else if (event.type === 'error') {
          setWsStateOverride('error');
        }
      },
      onTransportError: () => {
        setWsStateOverride('reconnecting');
      },
    });

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [selectedSymbol, resolution, lookbackId, basis, loadTicker, loadCandles]);

  const handleAcknowledgeAlert = useCallback(async (id: string) => {
    await acknowledgeAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }, []);

  const handleSaveGuardrail = useCallback(
    async (config: GuardrailConfig) => {
      await updateGuardrailConfig(config);
      await loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode);
    },
    [analysisSymbol, sentinelResolution, dataMode, loadSentinelOverview],
  );

  const handleKillSwitch = useCallback(
    async (reason: string) => {
      await triggerKillSwitch({ confirmed: true, reason });
      await loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode);
    },
    [analysisSymbol, sentinelResolution, dataMode, loadSentinelOverview],
  );

  const handleResumeStrategies = useCallback(async () => {
    await resumeStrategies(true);
    await loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode);
  }, [analysisSymbol, sentinelResolution, dataMode, loadSentinelOverview]);

  // Phase 3: Firebase Auth listener + Firestore user decisions subscription
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setAuthUser(user);
      setAuthLoading(false);
      setAuthError(null);
      if (!user) {
        setDecisionRecords([]);
        setDecisionsLoading(false);
        setDecisionsError(null);
        setDecisionsLastUpdated(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authLoading || !authUser) return;
    setDecisionsLoading(true);
    setDecisionsError(null);

    const unsubscribe = subscribeToUserDecisions({
      uid: authUser.uid,
      onData: (records, updatedAt) => {
        setDecisionRecords(records);
        setDecisionsLastUpdated(updatedAt);
        setDecisionsLoading(false);
        setDecisionsError(null);
      },
      onError: (message, timestamp) => {
        setDecisionsLoading(false);
        setDecisionsError({ message, timestamp });
      },
    });
    return () => unsubscribe();
  }, [authLoading, authUser]);

  // Persist user-defined rules and cooldown in localStorage (no preset rules)
  useEffect(() => {
    try {
      window.localStorage.setItem(USER_RULES_STORAGE_KEY, JSON.stringify(guardrailRules));
    } catch {
      // Ignore storage quota errors
    }
  }, [guardrailRules]);

  useEffect(() => {
    try {
      window.localStorage.setItem(USER_COOLDOWN_STORAGE_KEY, String(cooldownSeconds));
    } catch {
      // Ignore storage quota errors
    }
  }, [cooldownSeconds]);

  // Deterministic Phase 3 Guardrail Evaluation on real Phase 2 output
  const guardrailEvaluation = useMemo(
    () =>
      evaluateGuardrailRules({
        regimeOutput: phase2Regime,
        rules: guardrailRules,
      }),
    [phase2Regime, guardrailRules],
  );

  // Anti-spam alert reconciliation (only raises when action changes or a new rule fires, with cooldown)
  useEffect(() => {
    if (!guardrailEvaluation.available) return;
    setGuardrailAlerts((prev) => {
      const reconciled = reconcileAlertFeed({
        existingAlerts: prev,
        evaluation: guardrailEvaluation,
        cooldownSeconds,
      });
      if (!reconciled.createdAlert && reconciled.supersededCount === 0) {
        return prev;
      }
      return reconciled.alerts;
    });
  }, [guardrailEvaluation, cooldownSeconds]);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed');
    }
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    setAuthError(null);
    try {
      await signOutFromGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign out failed');
    }
  }, []);

  const handleRefreshDecisionLog = useCallback(async () => {
    if (!authUser) return;
    setDecisionsLoading(true);
    setDecisionsError(null);
    try {
      const res = await fetchUserDecisionsOnce(authUser.uid);
      setDecisionRecords(res.records);
      setDecisionsLastUpdated(res.fetchedAt);
    } catch (err) {
      setDecisionsError({
        message: formatFirestoreErrorMessage(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setDecisionsLoading(false);
    }
  }, [authUser]);

  const handleAddGuardrailRule = useCallback((rule: GuardrailRule) => {
    setGuardrailRules((prev) => [...prev, rule]);
  }, []);

  const handleToggleGuardrailRule = useCallback((ruleId: string) => {
    setGuardrailRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
    );
  }, []);

  const handleDeleteGuardrailRule = useCallback((ruleId: string) => {
    setGuardrailRules((prev) => prev.filter((r) => r.id !== ruleId));
  }, []);

  const handleDecideGuardrailAlert = useCallback(
    async (alertId: string, decision: AlertDecision) => {
      const target = guardrailAlerts.find((a) => a.id === alertId);
      if (!target || target.status !== 'pending' || target.decision !== null) {
        return;
      }

      const decidedAtIso = new Date().toISOString();
      const willPersist = Boolean(authUser);

      setGuardrailAlerts((prev) =>
        prev.map((a) => {
          if (a.id !== alertId || a.status !== 'pending') return a;
          return {
            ...a,
            status: decision,
            decision,
            decidedAt: decidedAtIso,
            firestoreState: willPersist ? 'saving' : 'not_saved',
            firestoreError: null,
          };
        }),
      );

      if (!willPersist) return;

      try {
        await saveGuardrailDecisionToFirestore(target, decision);
        setGuardrailAlerts((prev) =>
          prev.map((a) =>
            a.id === alertId ? { ...a, firestoreState: 'saved', firestoreError: null } : a,
          ),
        );
      } catch (err) {
        setGuardrailAlerts((prev) =>
          prev.map((a) =>
            a.id === alertId
              ? {
                  ...a,
                  firestoreState: 'error',
                  firestoreError: formatFirestoreErrorMessage(err),
                }
              : a,
          ),
        );
      }
    },
    [guardrailAlerts, authUser],
  );

  const handleRetrySaveGuardrailAlert = useCallback(
    async (alertId: string) => {
      const target = guardrailAlerts.find((a) => a.id === alertId);
      if (!target || !target.decision || !authUser) return;

      setGuardrailAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId ? { ...a, firestoreState: 'saving', firestoreError: null } : a,
        ),
      );

      try {
        await saveGuardrailDecisionToFirestore(target, target.decision);
        setGuardrailAlerts((prev) =>
          prev.map((a) =>
            a.id === alertId ? { ...a, firestoreState: 'saved', firestoreError: null } : a,
          ),
        );
      } catch (err) {
        setGuardrailAlerts((prev) =>
          prev.map((a) =>
            a.id === alertId
              ? {
                  ...a,
                  firestoreState: 'error',
                  firestoreError: formatFirestoreErrorMessage(err),
                }
              : a,
          ),
        );
      }
    },
    [guardrailAlerts, authUser],
  );

  const unacknowledgedAlertCount = useMemo(
    () => alerts.filter((a) => !a.acknowledged).length,
    [alerts],
  );
  const anyKilled = useMemo(
    () => overview?.strategies.some((s) => s.guardrail.status === 'killed') ?? false,
    [overview],
  );

  const availableAnalysisSymbols = useMemo(() => {
    const base = ['BTCUSD', 'ETHUSD'];
    if (selectedSymbol && !base.includes(selectedSymbol) && !selectedSymbol.startsWith('C-') && !selectedSymbol.startsWith('P-')) {
      return [...base, selectedSymbol];
    }
    return base;
  }, [selectedSymbol]);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B1120] text-slate-100">
      <TopBar
        health={health}
        wsStateOverride={wsStateOverride}
        isCheckingHealth={isCheckingHealth}
        onRefreshHealth={() => void loadHealth()}
        activeSection={activeSection}
        onNavigate={setActiveSection}
        mobileSidebarOpen={mobileSidebarOpen}
        onToggleMobileSidebar={() => setMobileSidebarOpen((o) => !o)}
        user={authUser}
        authLoading={authLoading}
        onSignIn={() => void handleGoogleSignIn()}
        onSignOut={() => void handleGoogleSignOut()}
      />

      <div className="mx-auto flex w-full max-w-[1680px] flex-1 gap-5 px-4 sm:px-6 py-5 items-start">
        <WorkspaceSidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          unacknowledgedAlertCount={unacknowledgedAlertCount}
          anyKilled={anyKilled}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <main className="min-w-0 flex-1 space-y-5">
          {/* Workspace Context & Data Provenance Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/90 bg-[#111A2E] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400">Pair</span>
                <div className="flex rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
                  {availableAnalysisSymbols.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => {
                        setAnalysisSymbol(sym);
                        if (products.some((p) => p.symbol === sym)) {
                          handleSelectSymbol(sym);
                        }
                      }}
                      className={`rounded px-2.5 py-1 font-mono text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                        analysisSymbol === sym
                          ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400">Timeframe</span>
                <div className="flex rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
                  {SENTINEL_RESOLUTIONS.map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => setResolution(res)}
                      className={`rounded px-2 py-1 font-mono text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                        sentinelResolution === res
                          ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-400">Data Source</span>
                <div className="flex rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
                  <button
                    type="button"
                    onClick={() => setDataMode('live')}
                    className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      dataMode === 'live'
                        ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Live Delta
                  </button>
                  <button
                    type="button"
                    onClick={() => setDataMode('demo')}
                    className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      dataMode === 'demo'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Demo Fallback
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {overview && (() => {
                const modeBadge = formatDataModeLabel(overview.dataMode);
                return (
                  <>
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-medium ${regimeBadgeClass(
                        overview.regime.regime,
                      )}`}
                    >
                      {overview.regime.regime} ({Math.round(overview.regime.confidence * 100)}%)
                    </span>
                    <span
                      className={`rounded border px-2 py-1 font-mono text-[11px] ${modeBadge.toneClass}`}
                    >
                      {modeBadge.label}
                    </span>
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => void loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode)}
                disabled={overviewLoading}
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${overviewLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Active Section View */}
          {activeSection === 'overview' && (
            <OverviewDashboard
              overview={overview}
              isLoading={overviewLoading}
              error={overviewError}
              onRetry={() => void loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode)}
              onNavigate={setActiveSection}
              onSelectStrategyForExplain={(id) => {
                setExplainStrategyId(id);
                setActiveSection('explain');
              }}
            />
          )}

          {activeSection === 'monitor' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[310px_minmax(0,1fr)] items-start">
                <InstrumentPicker
                  dataSource={marketSource}
                  onChangeDataSource={setMarketSource}
                  products={products}
                  underlyings={underlyings}
                  selectedSymbol={selectedSymbol}
                  onSelectSymbol={handleSelectSymbol}
                  isLoading={productsLoading}
                  error={productsError}
                  source={productsSource}
                  fetchedAt={productsFetchedAt}
                  onRetry={() => void loadProducts()}
                  alpacaHealth={alpacaHealth}
                  alpacaCheckingHealth={alpacaCheckingHealth}
                  onRefreshAlpacaHealth={() => void loadAlpacaHealth()}
                  alpacaSymbols={alpacaSymbols}
                  alpacaSelectedSymbol={alpacaSelectedSymbol}
                  onSelectAlpacaSymbol={handleSelectAlpacaSymbol}
                  alpacaLoading={alpacaSymbolsLoading}
                  alpacaError={alpacaSymbolsError}
                  alpacaFetchedAt={alpacaSymbolsFetchedAt}
                  onRetryAlpacaSymbols={() => void loadAlpacaSymbols()}
                />

                <div className="min-w-0 space-y-5">
                  {marketSource === 'delta' ? (
                    <>
                      <LiveTickerStrip
                        symbol={selectedSymbol}
                        ticker={ticker}
                        isLoading={tickerLoading}
                        error={tickerError}
                        source={tickerSource}
                        lastUpdated={tickerUpdatedAt}
                        onRefresh={() => {
                          if (selectedSymbol) void loadTicker(selectedSymbol);
                        }}
                      />

                      <CandleChartPanel
                        dataSource="delta"
                        symbol={selectedSymbol}
                        tickSize={selectedProduct?.tickSize ?? ticker?.tickSize ?? null}
                        resolution={resolution}
                        onChangeResolution={setResolution}
                        lookbackId={lookbackId}
                        onChangeLookback={setLookbackId}
                        basis={basis}
                        onChangeBasis={setBasis}
                        candles={candles}
                        liveCandle={liveCandle}
                        isLoading={candlesLoading}
                        error={candlesError}
                        source={candlesSource}
                        fetchedAt={candlesFetchedAt}
                        querySymbol={candlesQuerySymbol}
                        onRetry={() => {
                          if (selectedSymbol) {
                            void loadCandles(selectedSymbol, resolution, lookbackId, basis);
                          }
                        }}
                        detectedRegime={overview?.regime.regime ?? null}
                        regimeConfidence={overview?.regime.confidence ?? null}
                        phase2Regime={
                          phase2Regime?.sufficientData ? phase2Regime.currentRegime : null
                        }
                        phase2Score={phase2Regime?.sufficientData ? phase2Regime.score : null}
                        phase2Insufficient={
                          phase2Regime !== null && !phase2Regime.sufficientData
                        }
                        regimeTransitions={
                          phase2Regime?.sufficientData ? phase2Regime.transitions : []
                        }
                      />

                      <RegimeCard
                        symbol={selectedSymbol}
                        regime={phase2Regime}
                        isLoading={phase2RegimeLoading}
                        error={phase2RegimeError}
                        fetchedAt={phase2RegimeFetchedAt}
                        onRetry={() => {
                          if (selectedSymbol) {
                            const lbSec =
                              LOOKBACK_OPTIONS.find((opt) => opt.id === lookbackId)?.seconds ??
                              24 * 3600;
                            const end = Math.floor(Date.now() / 1000);
                            void loadPhase2Regime(
                              selectedSymbol,
                              resolution,
                              end - lbSec,
                              end,
                              basis,
                            );
                          }
                        }}
                      />

                      <GuardrailRulesPanel
                        rules={guardrailRules}
                        onAddRule={handleAddGuardrailRule}
                        onToggleRule={handleToggleGuardrailRule}
                        onDeleteRule={handleDeleteGuardrailRule}
                        cooldownSeconds={cooldownSeconds}
                        onChangeCooldownSeconds={setCooldownSeconds}
                        evaluation={guardrailEvaluation}
                      />

                      <GuardrailAlertFeed
                        alerts={guardrailAlerts}
                        user={authUser}
                        authLoading={authLoading}
                        authError={authError}
                        onSignIn={() => void handleGoogleSignIn()}
                        onDecide={(id, dec) => void handleDecideGuardrailAlert(id, dec)}
                        onRetrySave={(id) => void handleRetrySaveGuardrailAlert(id)}
                      />

                      <DecisionLogPanel
                        user={authUser}
                        authLoading={authLoading}
                        onSignIn={() => void handleGoogleSignIn()}
                        records={decisionRecords}
                        loading={decisionsLoading}
                        error={decisionsError}
                        lastUpdated={decisionsLastUpdated}
                        onRefresh={() => void handleRefreshDecisionLog()}
                      />
                    </>
                  ) : (
                    <>
                      {/* Alpaca Bars Header Strip (Step 1) */}
                      <section
                        aria-label="Alpaca Market Data Status"
                        className="rounded-lg border border-slate-800/90 bg-[#111A2E] px-5 py-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <div>
                              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                                Alpaca Read-Only Bars
                              </div>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className="font-mono text-lg font-semibold text-slate-100">
                                  {alpacaHealth?.configured
                                    ? alpacaSelectedSymbol || 'Select Symbol'
                                    : 'Alpaca not configured'}
                                </span>
                                {alpacaSelectedSymbol && alpacaHealth?.configured && (
                                  <span className="rounded border border-slate-700 bg-[#0B1120] px-2 py-0.5 font-mono text-[11px] text-slate-300">
                                    {alpacaSelectedSymbol.includes('/') ? 'Crypto' : 'US Equity'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              if (!alpacaHealth || !alpacaHealth.configured) {
                                return (
                                  <span className="inline-flex items-center gap-1.5 rounded border border-amber-500/35 bg-amber-950/25 px-2.5 py-1 font-mono text-xs text-amber-300">
                                    <KeyRound className="h-3.5 w-3.5" />
                                    <span>Not Configured</span>
                                  </span>
                                );
                              }
                              if (alpacaHealth.ok) {
                                return (
                                  <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/35 bg-emerald-950/25 px-2.5 py-1 font-mono text-xs text-emerald-300 tabular-nums">
                                    <Activity className="h-3.5 w-3.5" />
                                    <span>
                                      Connected
                                      {alpacaHealth.latencyMs !== null
                                        ? ` · ${alpacaHealth.latencyMs}ms`
                                        : ''}
                                    </span>
                                  </span>
                                );
                              }
                              return (
                                <span
                                  title={alpacaHealth.lastError ?? undefined}
                                  className="inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-950/25 px-2.5 py-1 font-mono text-xs text-rose-300"
                                >
                                  <WifiOff className="h-3.5 w-3.5" />
                                  <span>Connection Error</span>
                                </span>
                              );
                            })()}

                            {alpacaFeedInfo && (
                              <span
                                title={alpacaFeedInfo.note}
                                className={`rounded border px-2.5 py-1 font-mono text-xs ${
                                  alpacaFeedInfo.isDelayed
                                    ? 'border-amber-500/35 bg-amber-950/25 text-amber-300'
                                    : 'border-sky-500/35 bg-sky-950/25 text-sky-300'
                                }`}
                              >
                                {alpacaFeedInfo.label}
                                {alpacaFeedInfo.isDelayed
                                  ? ` · ${alpacaFeedInfo.delayMinutes}m delayed`
                                  : ' · Real-time'}
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => void loadAlpacaHealth()}
                              disabled={alpacaCheckingHealth}
                              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${alpacaCheckingHealth ? 'animate-spin' : ''}`}
                              />
                              <span>Check Health</span>
                            </button>
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2 text-[11px] text-slate-400">
                          <span className="font-mono tabular-nums">
                            Source: Alpaca, last updated: {formatTimestamp(alpacaCandlesFetchedAt)}
                          </span>
                          <span>
                            Market data only (<code className="font-mono text-slate-300">data.alpaca.markets</code>) · Step 1 Bars Preview
                          </span>
                        </div>
                      </section>

                      <CandleChartPanel
                        dataSource="alpaca"
                        symbol={alpacaSelectedSymbol}
                        tickSize={0.01}
                        resolution={resolution}
                        onChangeResolution={setResolution}
                        lookbackId={lookbackId}
                        onChangeLookback={setLookbackId}
                        basis={basis}
                        onChangeBasis={setBasis}
                        candles={alpacaCandles}
                        liveCandle={null}
                        isLoading={alpacaCandlesLoading}
                        error={alpacaCandlesError}
                        source="Source: Alpaca"
                        fetchedAt={alpacaCandlesFetchedAt}
                        querySymbol={alpacaSelectedSymbol}
                        onRetry={() => {
                          if (alpacaSelectedSymbol && alpacaHealth?.configured) {
                            void loadAlpacaCandles(
                              alpacaSelectedSymbol,
                              resolution,
                              lookbackId,
                              alpacaFeed,
                            );
                          }
                        }}
                        alpacaConfigured={alpacaHealth?.configured ?? false}
                        alpacaFeed={alpacaFeed}
                        onChangeAlpacaFeed={setAlpacaFeed}
                        alpacaFeedInfo={alpacaFeedInfo}
                      />
                    </>
                  )}
                </div>
              </div>

              {marketSource === 'delta' && (
                <ContractSpecsPanel
                  product={selectedProduct}
                  source={productsSource}
                  fetchedAt={productsFetchedAt}
                />
              )}
            </div>
          )}

          {activeSection === 'regime' && (
            <RegimeEnginePanel
              overview={overview}
              alerts={alerts}
              onAcknowledgeAlert={(id) => void handleAcknowledgeAlert(id)}
              onSelectSymbolResolution={(sym, res) => {
                setAnalysisSymbol(sym);
                setResolution(res);
              }}
            />
          )}

          {activeSection === 'health' && (
            <StrategyHealthPanel
              overview={overview}
              onInspectExplanation={(id) => {
                setExplainStrategyId(id);
                setActiveSection('explain');
              }}
            />
          )}

          {activeSection === 'risk' && (
            <RiskPredictionPanel
              overview={overview}
              onInspectExplanation={(id) => {
                setExplainStrategyId(id);
                setActiveSection('explain');
              }}
            />
          )}

          {activeSection === 'guardrails' && (
            <GuardrailCenterPanel
              overview={overview}
              onSaveGuardrail={handleSaveGuardrail}
              onKillSwitch={handleKillSwitch}
              onResumeStrategies={handleResumeStrategies}
            />
          )}

          {activeSection === 'explain' && (
            <ExplainabilityPanel
              overview={overview}
              selectedStrategyId={explainStrategyId}
              onSelectStrategyId={setExplainStrategyId}
              resolution={sentinelResolution}
              dataMode={dataMode}
            />
          )}

          {activeSection === 'paper' && <PaperSimulatorPanel />}

          {activeSection === 'training' && (
            <TrainingCenterPanel
              symbol={analysisSymbol}
              resolution={sentinelResolution}
              onModelDeployed={() =>
                void loadSentinelOverview(analysisSymbol, sentinelResolution, dataMode)
              }
            />
          )}

          {activeSection === 'audit' && <AuditHistoryPanel />}

          {activeSection === 'specs' && (
            <div className="space-y-5">
              <InstrumentPicker
                dataSource="delta"
                onChangeDataSource={(src) => {
                  setMarketSource(src);
                  if (src === 'alpaca') setActiveSection('monitor');
                }}
                products={products}
                underlyings={underlyings}
                selectedSymbol={selectedSymbol}
                onSelectSymbol={handleSelectSymbol}
                isLoading={productsLoading}
                error={productsError}
                source={productsSource}
                fetchedAt={productsFetchedAt}
                onRetry={() => void loadProducts()}
                alpacaHealth={alpacaHealth}
                alpacaCheckingHealth={alpacaCheckingHealth}
                onRefreshAlpacaHealth={() => void loadAlpacaHealth()}
                alpacaSymbols={alpacaSymbols}
                alpacaSelectedSymbol={alpacaSelectedSymbol}
                onSelectAlpacaSymbol={handleSelectAlpacaSymbol}
                alpacaLoading={alpacaSymbolsLoading}
                alpacaError={alpacaSymbolsError}
                alpacaFetchedAt={alpacaSymbolsFetchedAt}
                onRetryAlpacaSymbols={() => void loadAlpacaSymbols()}
              />
              <ContractSpecsPanel
                product={selectedProduct}
                source={productsSource}
                fetchedAt={productsFetchedAt}
              />
            </div>
          )}

          {activeSection === 'system' && (
            <div className="space-y-5">
              <SystemHealthPanel
                health={health}
                symbol={analysisSymbol}
                resolution={sentinelResolution}
                dataMode={dataMode}
                onRefreshHealth={() => void loadHealth()}
              />
              <PhaseRoadmapStrip />
            </div>
          )}

          {activeSection === 'deck' && <CompetitionDeckPanel overview={overview} />}
        </main>
      </div>

      <footer className="border-t border-slate-800/80 bg-[#0B1120] px-6 py-4">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <span>
            Regime Sentinel · Delta Exchange × Techfest 2026–27 · Paper Safety Default · Not financial advice.
          </span>
          <span className="font-mono text-[11px] text-slate-500">
            Data proxied server-side from api.india.delta.exchange (public market data only)
          </span>
        </div>
      </footer>
    </div>
  );
}

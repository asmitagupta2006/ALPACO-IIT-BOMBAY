import { useEffect, useState } from 'react';
import { CheckCircle2, Play, RefreshCw } from 'lucide-react';
import {
  deployTrainedModel,
  fetchTrainingStatus,
  runTrainingJob,
  type TrainingStatusResponse,
} from '../../api/sentinelApi';
import type { CandleResolution } from '../../contracts/delta';
import type { ModelVersionRecord } from '../../contracts/sentinel';
import { formatTimestamp } from '../../utils/format';

interface TrainingCenterPanelProps {
  symbol: string;
  resolution: CandleResolution;
  onModelDeployed: () => void;
}

export function TrainingCenterPanel({
  symbol,
  resolution,
  onModelDeployed,
}: TrainingCenterPanelProps) {
  const [status, setStatus] = useState<TrainingStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modelKind, setModelKind] = useState<'regime' | 'risk'>('regime');
  const [algorithm, setAlgorithm] = useState<'gbdt' | 'random_forest'>('gbdt');
  const [trainSymbol, setTrainSymbol] = useState<string>(
    symbol === 'ETHUSD' ? 'ETHUSD' : 'BTCUSD',
  );
  const [trainRes, setTrainRes] = useState<CandleResolution>(
    resolution === '1h' || resolution === '5m' || resolution === '4h' ? resolution : '15m',
  );
  const [horizonMinutes, setHorizonMinutes] = useState<30 | 60>(30);
  const [training, setTraining] = useState(false);
  const [lastComparison, setLastComparison] = useState<{
    candidate: ModelVersionRecord;
    recommendation: string;
    deltaAccuracy: number | null;
  } | null>(null);

  const [inspectModelId, setInspectModelId] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTrainingStatus(trainSymbol, trainRes);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load training status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [trainSymbol, trainRes]);

  const handleTrain = async () => {
    setTraining(true);
    setError(null);
    try {
      const res = await runTrainingJob({
        modelKind,
        algorithm,
        symbol: trainSymbol,
        resolution: trainRes,
        horizonMinutes,
      });
      setLastComparison({
        candidate: res.candidate,
        recommendation: res.deployedComparison.recommendation,
        deltaAccuracy: res.deployedComparison.deltaAccuracy,
      });
      setInspectModelId(res.candidate.id);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Training run failed');
    } finally {
      setTraining(false);
    }
  };

  const handleDeploy = async (modelId: string) => {
    setError(null);
    try {
      await deployTrainedModel({ modelId, confirmed: true });
      await loadStatus();
      onModelDeployed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
    }
  };

  if (loading && !status) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading AI Model Training Center...
      </div>
    );
  }

  const models =
    modelKind === 'regime' ? status?.regimeModels ?? [] : status?.riskModels ?? [];
  const inspected =
    models.find((m) => m.id === inspectModelId) ??
    models.find((m) => m.deployed) ??
    models[0] ??
    null;

  const rep = status?.datasetReport;

  return (
    <div className="space-y-5">
      {/* Dataset Quality + Training Launcher */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Dataset Quality &amp; Chronological Pipeline Audit
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Zero random shuffling · Causal indicators · 70% Train / 15% Val / 15% Untouched Test + Purge Gap
              </p>
            </div>
            <span
              className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                status?.liveDriftStatus === 'Drift Alert'
                  ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                  : status?.liveDriftStatus === 'Moderate Shift'
                    ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                    : 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300'
              }`}
            >
              PSI Drift: {status?.liveDriftPsi.toFixed(3)} ({status?.liveDriftStatus})
            </span>
          </div>

          {rep && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs tabular-nums">
                <StatBox label="Valid Cleaned Bars" value={String(rep.validBars)} />
                <StatBox label="Quality Score" value={`${rep.qualityScore}/100`} />
                <StatBox label="Missing Bars" value={`${rep.missingBarsDetected} (${rep.missingBarsFilled} filled)`} />
                <StatBox label="Dups / Anomalies" value={`${rep.duplicatesRemoved} / ${rep.anomaliesRepaired}`} />
              </div>
              <div className="space-y-1 text-[11px] text-slate-400">
                {rep.notes.map((n, i) => (
                  <div key={i}>• {n}</div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-3.5">
          <h2 className="font-display text-sm font-semibold text-slate-100 border-b border-slate-800/80 pb-2.5">
            Backend Model Training &amp; Validation Runner
          </h2>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Model Objective</label>
              <select
                aria-label="Model objective"
                value={modelKind}
                onChange={(e) => {
                  setModelKind(e.target.value === 'risk' ? 'risk' : 'regime');
                  setInspectModelId(null);
                }}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
              >
                <option value="regime">Model 1: Regime Classifier</option>
                <option value="risk">Model 2: Deterioration Risk</option>
              </select>
            </div>

            {modelKind === 'regime' ? (
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Algorithm</label>
                <select
                  aria-label="Regime ML algorithm"
                  value={algorithm}
                  onChange={(e) =>
                    setAlgorithm(e.target.value === 'random_forest' ? 'random_forest' : 'gbdt')
                  }
                  className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="gbdt">Gradient Boosted Trees (GBDT)</option>
                  <option value="random_forest">Random Forest (Ensemble)</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Risk Horizon</label>
                <select
                  aria-label="Risk horizon"
                  value={horizonMinutes}
                  onChange={(e) => setHorizonMinutes(Number(e.target.value) === 60 ? 60 : 30)}
                  className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value={30}>30-Minute Horizon</option>
                  <option value={60}>60-Minute Horizon</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Contract</label>
              <select
                aria-label="Training contract"
                value={trainSymbol}
                onChange={(e) => setTrainSymbol(e.target.value)}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              >
                <option value="BTCUSD">BTCUSD</option>
                <option value="ETHUSD">ETHUSD</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Candle Resolution</label>
              <select
                aria-label="Training resolution"
                value={trainRes}
                onChange={(e) => setTrainRes(e.target.value as CandleResolution)}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              >
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          <button
            type="button"
            onClick={() => void handleTrain()}
            disabled={training}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-sky-500/45 bg-sky-950/40 px-4 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 cursor-pointer disabled:opacity-50"
          >
            {training ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span>
              {training ? 'Executing Backend Chronological Training...' : 'Train & Evaluate Candidate Model'}
            </span>
          </button>

          {lastComparison && (
            <div className="rounded border border-sky-500/30 bg-sky-950/20 p-3 text-xs space-y-1">
              <div className="font-semibold text-sky-200">
                Candidate {lastComparison.candidate.version} Evaluated
              </div>
              <p className="text-slate-300">{lastComparison.recommendation}</p>
              {lastComparison.deltaAccuracy !== null && (
                <div className="font-mono text-[11px] text-slate-400">
                  Untouched Test Delta:{' '}
                  <span className={lastComparison.deltaAccuracy >= 0 ? 'text-emerald-300' : 'text-amber-300'}>
                    {lastComparison.deltaAccuracy >= 0 ? '+' : ''}
                    {(lastComparison.deltaAccuracy * 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Model Evaluation Metrics, Confusion Matrix, Walk-Forward CV, Feature Importance */}
      {inspected && (
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Actual Out-of-Sample Evaluation — {inspected.version} ({inspected.algorithm})
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                Scope: {inspected.symbolScope} {inspected.resolution} · Split: {inspected.metrics.splitSummary.trainRows} Train /{' '}
                {inspected.metrics.splitSummary.valRows} Val / {inspected.metrics.splitSummary.testRows} Untouched Test (Purge {inspected.metrics.splitSummary.purgeGapBars} bars)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  inspected.deployed
                    ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                }`}
              >
                {inspected.deployed ? 'Deployed in Production' : 'Candidate (Requires Human Approval)'}
              </span>
              {!inspected.deployed && (
                <button
                  type="button"
                  onClick={() => void handleDeploy(inspected.id)}
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-500/45 bg-emerald-950/35 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/45 cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Approve &amp; Deploy</span>
                </button>
              )}
            </div>
          </div>

          {/* Real Honest Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono text-xs tabular-nums">
            <StatBox label="Train Accuracy" value={`${(inspected.metrics.trainAccuracy * 100).toFixed(1)}%`} />
            <StatBox label="Validation Accuracy" value={`${(inspected.metrics.valAccuracy * 100).toFixed(1)}%`} />
            <StatBox
              label="Untouched Test Acc"
              value={`${(inspected.metrics.testAccuracy * 100).toFixed(1)}%`}
              highlight={inspected.metrics.testAccuracy >= 0.7 ? 'text-emerald-300' : 'text-amber-300'}
            />
            <StatBox label="Macro Precision" value={`${(inspected.metrics.macroPrecision * 100).toFixed(1)}%`} />
            <StatBox label="Macro Recall / F1" value={`${(inspected.metrics.macroRecall * 100).toFixed(1)}% / ${(inspected.metrics.macroF1 * 100).toFixed(1)}%`} />
            <StatBox label="Brier Score" value={inspected.metrics.brierScore.toFixed(4)} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Confusion Matrix */}
            <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-200">
                Untouched Test Set Confusion Matrix (Rows = Actual, Cols = Predicted)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 pr-2 text-left font-sans">Actual \ Pred</th>
                      {inspected.metrics.confusionMatrix.labels.map((lbl) => {
                        const shortLbl =
                          lbl === 'High Volatility'
                            ? 'High Vol'
                            : lbl === 'Low Volatility'
                              ? 'Low Vol'
                              : lbl === 'Transition / Unstable'
                                ? 'Unstable'
                                : lbl;
                        return (
                          <th key={lbl} className="px-2 py-1.5 text-right whitespace-nowrap" title={lbl}>
                            {shortLbl}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {inspected.metrics.confusionMatrix.matrix.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="py-1.5 pr-2 font-sans text-slate-300 truncate max-w-[120px]">
                          {inspected.metrics.confusionMatrix.labels[rIdx]}
                        </td>
                        {row.map((val, cIdx) => (
                          <td
                            key={cIdx}
                            className={`px-2 py-1.5 text-right ${
                              rIdx === cIdx && val > 0
                                ? 'text-emerald-300 font-semibold bg-emerald-950/20'
                                : val > 0
                                  ? 'text-amber-300'
                                  : 'text-slate-600'
                            }`}
                          >
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Feature Importance */}
            <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-200">
                Top Feature Importances (Gain-Weighted)
              </h3>
              <div className="space-y-2">
                {inspected.metrics.featureImportance.slice(0, 8).map((fi) => {
                  const maxImp = Math.max(0.01, inspected.metrics.featureImportance[0]?.importance ?? 0.1);
                  const widthPct = Math.min(100, (fi.importance / maxImp) * 100);
                  return (
                    <div key={fi.feature} className="space-y-0.5 text-xs">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300">{fi.label}</span>
                        <span className="font-mono text-slate-300 tabular-nums">
                          {(fi.importance * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full bg-sky-500" style={{ width: `${Math.max(3, widthPct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Walk-Forward Validation Folds */}
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-2">
            <h3 className="text-xs font-semibold text-slate-200">
              Expanding-Window Walk-Forward Time-Series Validation
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-sans text-slate-400">
                    <th className="py-1.5 pr-3">Fold</th>
                    <th className="py-1.5 px-3">Train Rows</th>
                    <th className="py-1.5 px-3">Test Rows</th>
                    <th className="py-1.5 px-3">Out-of-Sample Acc</th>
                    <th className="py-1.5 px-3">Macro F1</th>
                    <th className="py-1.5 pl-3">Brier Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {inspected.metrics.walkForwardFolds.map((f) => (
                    <tr key={f.fold}>
                      <td className="py-1.5 pr-3 text-slate-200">Fold {f.fold}</td>
                      <td className="py-1.5 px-3 text-slate-300">{f.trainCount}</td>
                      <td className="py-1.5 px-3 text-slate-300">{f.testCount}</td>
                      <td className="py-1.5 px-3 text-sky-300">{(f.accuracy * 100).toFixed(1)}%</td>
                      <td className="py-1.5 px-3 text-slate-200">{(f.macroF1 * 100).toFixed(1)}%</td>
                      <td className="py-1.5 pl-3 text-slate-300">{f.brierScore.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Version Registry History */}
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
        <h3 className="font-display text-sm font-semibold text-slate-100 mb-3">
          Model Version Registry ({modelKind === 'regime' ? 'Model 1 Regime' : 'Model 2 Risk'})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="py-2 pr-3 font-medium">Version / Algorithm</th>
                <th className="py-2 px-3 font-medium">Scope</th>
                <th className="py-2 px-3 font-medium text-right">Test Acc</th>
                <th className="py-2 px-3 font-medium text-right">Macro F1</th>
                <th className="py-2 px-3 font-medium text-right">Brier</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 pl-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {models.map((m) => (
                <tr key={m.id} className={m.id === inspected?.id ? 'bg-sky-950/20' : ''}>
                  <td className="py-2.5 pr-3">
                    <div className="font-mono font-semibold text-slate-100">{m.version}</div>
                    <div className="text-[11px] text-slate-400">{m.algorithm} · {formatTimestamp(m.createdAt)}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">
                    {m.symbolScope} · {m.resolution}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-100">
                    {(m.metrics.testAccuracy * 100).toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                    {(m.metrics.macroF1 * 100).toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                    {m.metrics.brierScore.toFixed(4)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={m.deployed ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                      {m.status}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setInspectModelId(m.id)}
                      className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      Inspect
                    </button>
                    {!m.deployed && (
                      <button
                        type="button"
                        onClick={() => void handleDeploy(m.id)}
                        className="rounded border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-950/40 cursor-pointer"
                      >
                        Deploy
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatBox({
  label,
  value,
  highlight = 'text-slate-100',
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div className="rounded border border-slate-800/80 bg-[#0B1120] p-2.5">
      <div className="font-sans text-[11px] text-slate-400 truncate">{label}</div>
      <div className={`mt-1 text-xs font-semibold truncate ${highlight}`}>{value}</div>
    </div>
  );
}

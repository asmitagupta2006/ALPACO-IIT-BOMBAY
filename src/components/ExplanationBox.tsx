import { AlertCircle, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import type { AlertExplanationState, AlertExplanationSummary } from '../contracts/guardrails';
import { formatTimestamp } from '../utils/format';

interface ExplanationBoxProps {
  title?: string;
  configured: boolean;
  disabledReason?: string | null;
  state: AlertExplanationState;
  explanation: AlertExplanationSummary | null;
  error: { message: string; timestamp: string } | null;
  onRetry?: () => void;
}

export function ExplanationBox({
  title = 'Gemini Explanation',
  configured,
  disabledReason,
  state,
  explanation,
  error,
  onRetry,
}: ExplanationBoxProps) {
  return (
    <div className="rounded-md border border-slate-800/90 bg-[#111A2E]/90 p-3 text-xs space-y-2.5">
      {/* Header & Non-Authoritative Disclaimer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 pb-2">
        <div className="flex items-center gap-1.5 text-slate-200 font-medium">
          <Sparkles className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
          <span>{title}</span>
          {explanation?.status === 'unverified' && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>Unverified</span>
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400">
          AI-generated explanation. Decisions come from the rules, not the model.
        </span>
      </div>

      {/* State: Server Gemini Env Not Configured */}
      {!configured ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
          <span>
            Explanations not configured
            {disabledReason && disabledReason !== 'Explanations not configured'
              ? ` — ${disabledReason.replace(/^Explanations not configured\s*/i, '')}`
              : ''}
          </span>
        </div>
      ) : state === 'loading' || (state === 'idle' && !explanation && !error) ? (
        <div className="flex items-center gap-2 text-slate-300 py-1">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400" aria-hidden="true" />
          <span>Generating Gemini explanation from computed telemetry...</span>
        </div>
      ) : state === 'error' || error ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded border border-rose-500/35 bg-rose-950/20 px-3 py-2 text-rose-200">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
            <div className="space-y-0.5 min-w-0">
              <div className="font-medium text-rose-100">Explanation unavailable</div>
              <div className="text-rose-300/90 break-words">
                {error?.message ?? 'Failed to retrieve Gemini explanation.'}
              </div>
              {error?.timestamp && (
                <div className="font-mono text-[10px] text-rose-400/80 tabular-nums">
                  At {formatTimestamp(error.timestamp)}
                </div>
              )}
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded border border-rose-500/45 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer shrink-0"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>Retry</span>
            </button>
          )}
        </div>
      ) : explanation ? (
        <div className="space-y-2.5">
          {/* Verification Warning Banner if flagged unverified */}
          {explanation.status === 'unverified' && explanation.warnings.length > 0 && (
            <div className="rounded border border-amber-500/45 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span>Verification warning: output flagged as unverified</span>
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-amber-200/90">
                {explanation.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary */}
          <p className="text-slate-100 leading-relaxed">{explanation.summary}</p>

          {/* Why It Fired */}
          {explanation.whyItFired.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-slate-400">Why it fired</div>
              <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
                {explanation.whyItFired.map((point, idx) => (
                  <li key={idx}>{point}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Key Numbers */}
          {explanation.keyNumbers.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-slate-400">Key numbers</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {explanation.keyNumbers.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-[#0B1120] px-2.5 py-1 font-mono text-[11px]"
                  >
                    <span className="text-slate-400 truncate">{item.name}</span>
                    <span className="text-slate-100 font-medium tabular-nums shrink-0">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Limitations */}
          {explanation.limitations.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-slate-400">Limitations</div>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-slate-400">
                {explanation.limitations.map((lim, idx) => (
                  <li key={idx}>{lim}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Provenance Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2 text-[11px] text-slate-400">
            <span className="font-mono tabular-nums">
              Source: Gemini ({explanation.modelName}), generated {formatTimestamp(explanation.generatedAt)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

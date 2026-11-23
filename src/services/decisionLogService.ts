import {
  Timestamp,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type {
  AlertDecision,
  AlertExplanationSummary,
  FirestoreDecisionRecord,
  FirestoreExplanationData,
  GuardrailAlert,
} from '../contracts/guardrails';
import {
  OperationType,
  auth,
  db,
  formatFirestoreErrorMessage,
  handleFirestoreError,
} from '../firebase';

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : `dec_${Date.now()}`;
}

function sanitizeString(value: string, maxLen: number, fallback: string): string {
  const trimmed = value.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : fallback;
}

function toIsoStringOrNull(val: unknown): string | null {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: unknown }).toDate === 'function') {
    return ((val as { toDate: () => Date }).toDate()).toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return null;
}

function mapExplanation(raw: unknown): FirestoreExplanationData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.text !== 'string' || typeof e.model !== 'string' || typeof e.generatedAt !== 'string') {
    return null;
  }
  return {
    text: e.text,
    model: e.model,
    generatedAt: e.generatedAt,
    recordedAt: toIsoStringOrNull(e.recordedAt),
    status: e.status === 'unverified' ? 'unverified' : 'verified',
    summary: typeof e.summary === 'string' ? e.summary : e.text,
    whyItFired: Array.isArray(e.whyItFired) ? e.whyItFired.map(String) : [],
    limitations: Array.isArray(e.limitations) ? e.limitations.map(String) : [],
  };
}

function mapSnapshotDoc(snap: QueryDocumentSnapshot): FirestoreDecisionRecord {
  const d = snap.data();
  return {
    id: snap.id,
    uid: typeof d.uid === 'string' ? d.uid : '',
    symbol: typeof d.symbol === 'string' ? d.symbol : '—',
    timeframe: (typeof d.timeframe === 'string' ? d.timeframe : '15m') as FirestoreDecisionRecord['timeframe'],
    regime: (typeof d.regime === 'string' ? d.regime : 'Calm/Range') as FirestoreDecisionRecord['regime'],
    riskScore: typeof d.riskScore === 'number' ? d.riskScore : 0,
    inputValues: (d.inputValues ?? {
      regime: 'Calm/Range',
      riskScore: 0,
      volZScore: null,
      trendStrength: null,
      cusumMax: null,
      fundingRate: null,
      markIndexBasis: null,
      oiChange6h: null,
      impliedVolatility: null,
    }) as FirestoreDecisionRecord['inputValues'],
    rulesFired: Array.isArray(d.rulesFired) ? d.rulesFired.map(String) : [],
    thresholds: Array.isArray(d.thresholds) ? d.thresholds.map(String) : [],
    action: (typeof d.action === 'string' ? d.action : 'CONTINUE') as FirestoreDecisionRecord['action'],
    decision:
      d.decision === 'approved' || d.decision === 'dismissed' ? d.decision : null,
    createdAt: toIsoStringOrNull(d.createdAt),
    decidedAt: toIsoStringOrNull(d.decidedAt),
    candleTimestamp: typeof d.candleTimestamp === 'string' ? d.candleTimestamp : '',
    explanation: mapExplanation(d.explanation),
  };
}

function sortNewestFirst(records: FirestoreDecisionRecord[]): FirestoreDecisionRecord[] {
  return [...records].sort((a, b) => {
    const ta = a.decidedAt ?? a.createdAt ?? '';
    const tb = b.decidedAt ?? b.createdAt ?? '';
    return tb.localeCompare(ta);
  });
}

function buildSanitizedExplanationPayload(exp: AlertExplanationSummary) {
  const whyList =
    exp.whyItFired.length > 0
      ? exp.whyItFired.slice(0, 10).map((s) => sanitizeString(s, 400, 'Rule threshold met.'))
      : [sanitizeString(exp.summary, 400, 'Rule threshold met.')];

  const limList = exp.limitations
    .slice(0, 10)
    .map((s) => sanitizeString(s, 400, ''))
    .filter((s) => s.length > 0);

  return {
    text: sanitizeString(exp.text, 4000, sanitizeString(exp.summary, 1000, 'Explanation recorded.')),
    model: sanitizeString(exp.modelName, 100, 'gemini'),
    generatedAt: sanitizeString(exp.generatedAt, 40, new Date().toISOString()),
    recordedAt: serverTimestamp(),
    status: exp.status === 'unverified' ? 'unverified' : 'verified',
    summary: sanitizeString(exp.summary, 1000, 'Explanation summary recorded.'),
    whyItFired: whyList,
    limitations: limList,
  };
}

function buildSanitizedPayload(uid: string, alert: GuardrailAlert, decision: AlertDecision) {
  const safeSymbol = sanitizeString(
    alert.symbol.replace(/[^A-Za-z0-9_.\-/]/g, ''),
    40,
    'UNKNOWN',
  );
  const safeScore = Math.max(
    0,
    Math.min(100, Number.isFinite(alert.riskScore) ? alert.riskScore : 0),
  );
  const optNum = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null);

  const rulesFired =
    alert.ruleNames.length > 0
      ? alert.ruleNames.slice(0, 20).map((s) => sanitizeString(s, 120, 'Rule'))
      : ['Unnamed Rule'];
  const thresholds =
    alert.thresholds.length > 0
      ? alert.thresholds.slice(0, 20).map((s) => sanitizeString(s, 200, 'Threshold'))
      : ['Threshold matched'];

  return {
    uid,
    createdAt: serverTimestamp(),
    symbol: safeSymbol,
    timeframe: alert.timeframe,
    regime: alert.regime,
    riskScore: safeScore,
    inputValues: {
      regime: alert.inputValues.regime,
      riskScore: Math.max(
        0,
        Math.min(100, Number.isFinite(alert.inputValues.riskScore) ? alert.inputValues.riskScore : 0),
      ),
      volZScore: optNum(alert.inputValues.volZScore),
      trendStrength: optNum(alert.inputValues.trendStrength),
      cusumMax: optNum(alert.inputValues.cusumMax),
      fundingRate: optNum(alert.inputValues.fundingRate),
      markIndexBasis: optNum(alert.inputValues.markIndexBasis),
      oiChange6h: optNum(alert.inputValues.oiChange6h),
      impliedVolatility: optNum(alert.inputValues.impliedVolatility),
    },
    rulesFired,
    thresholds,
    action: alert.action,
    decision,
    decidedAt: serverTimestamp(),
    candleTimestamp: sanitizeString(alert.candleTimestamp, 40, new Date().toISOString()),
    explanation: alert.explanation ? buildSanitizedExplanationPayload(alert.explanation) : null,
  };
}

/**
 * Persists a single user decision (and optional Gemini explanation if already generated)
 * to users/{uid}/decisions/{decisionId}. No PII stored.
 */
export async function saveGuardrailDecisionToFirestore(
  alert: GuardrailAlert,
  decision: AlertDecision,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in with Google to save decisions to Firestore.');
  }

  const docId = sanitizeId(alert.id);
  const path = `users/${user.uid}/decisions/${docId}`;
  const payload = buildSanitizedPayload(user.uid, alert, decision);

  try {
    await setDoc(doc(db, 'users', user.uid, 'decisions', docId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Appends a Gemini explanation once onto an already-saved decision document.
 * Allowed by firestore.rules ONLY when existing().explanation == null and no other field changes.
 */
export async function attachExplanationToFirestoreDecision(
  alertId: string,
  explanation: AlertExplanationSummary,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const docId = sanitizeId(alertId);
  const path = `users/${user.uid}/decisions/${docId}`;
  const payload = buildSanitizedExplanationPayload(explanation);

  try {
    await updateDoc(doc(db, 'users', user.uid, 'decisions', docId), {
      explanation: payload,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToUserDecisions(params: {
  uid: string;
  onData: (records: FirestoreDecisionRecord[], updatedAt: string) => void;
  onError: (message: string, timestamp: string) => void;
}): () => void {
  const path = `users/${params.uid}/decisions`;
  const q = query(collection(db, 'users', params.uid, 'decisions'), where('uid', '==', params.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const records = sortNewestFirst(snapshot.docs.map(mapSnapshotDoc));
      params.onData(records, new Date().toISOString());
    },
    (error) => {
      const ts = new Date().toISOString();
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        params.onError(formatFirestoreErrorMessage(wrapped), ts);
      }
    },
  );
}

export async function fetchUserDecisionsOnce(uid: string): Promise<{
  records: FirestoreDecisionRecord[];
  fetchedAt: string;
}> {
  const path = `users/${uid}/decisions`;
  const q = query(collection(db, 'users', uid, 'decisions'), where('uid', '==', uid));

  try {
    const snap = await getDocs(q);
    return {
      records: sortNewestFirst(snap.docs.map(mapSnapshotDoc)),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

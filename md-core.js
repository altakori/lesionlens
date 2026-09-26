/* Local DEMO workflow. No network transport or real patient mapping. */
(function (g) {
  'use strict';
  const labels = {gt:'GT', cappyv2:'CAPPY2 current', cp050:'CAPPY2 050', baseline:'Baseline'};
  const models = ['cappyv2','cp050','baseline'];
  // Structured follow-up opinion written by the reviewing MD. Nothing is pre-selected:
  // an absent key means no opinion was given, and no code path infers one.
  const followupOptions = ['short_term_followup','immediate_us_biopsy','other','none'];
  const followupLabels = {short_term_followup:'단기 추적검사', immediate_us_biopsy:'즉시 US 유도 조직검사', other:'기타(직접 입력)', none:'의견 없음'};
  function followupLabel(value) {
    if (value === undefined) return '이 전송에는 의견 기록이 없습니다.';
    if (typeof value !== 'string' || !Object.hasOwn(followupLabels, value)) return '읽을 수 없는 의견 유형';
    return followupLabels[value];
  }
  // Pre-opinion the reviewing MD may record next to the AI disagreement signals.
  // Nothing is pre-selected and no code path infers a value. The review list already
  // shows model disagreement, so this is a reference record, not an independent pre-read.
  const precheckOptions = ['recheck_needed','not_needed','deferred'];
  const precheckLabels = {recheck_needed:'재확인 필요', not_needed:'재확인 불필요', deferred:'판단 유보'};
  function precheckLabel(value) {
    if (value === undefined) return '이 전송에는 사전 의견이 기록되지 않았습니다.';
    if (typeof value !== 'string' || !Object.hasOwn(precheckLabels, value)) return '읽을 수 없는 사전 의견';
    return precheckLabels[value];
  }
  const demo = {id:'DEMO-WORKFLOW-001', synthetic:true, slices:[], models:{},
    mapping:{patientId:'DEMO-PATIENT', recipientId:'DEMO-CLINICIAN', department:'DEMO clinical team', approved:true, demo:true}};
  const clone = x => JSON.parse(JSON.stringify(x));
  function eligible(c) { return c?.synthetic === true && c.id === demo.id && JSON.stringify(c.mapping) === JSON.stringify(demo.mapping) && Array.isArray(c.slices) && c.slices.length === 0 && c.models && Object.keys(c.models).length === 0; }
  function availableModel(c, key) {
    return models.includes(key) && !!c.models?.[key] && Array.isArray(c.slices) && c.slices.length > 0 && c.slices.every(s => !!s.overlays?.[key]);
  }
  function selection(c, selected, none) {
    return Array.isArray(selected) && new Set(selected).size === selected.length &&
      ((none === true && selected.length === 0) || (none === false && selected.length > 0 && selected.every(k => availableModel(c, k))));
  }
  function normalizeReferences(c, selected, none) {
    // Explicit none wins a contradictory saved choice; invalid/missing sources
    // are never substituted. An empty selection always means explicit none.
    const valid = none === true || !Array.isArray(selected) ? [] : models.filter(k => selected.includes(k) && availableModel(c, k));
    return {selected: valid, none: valid.length === 0};
  }
  function normalizeDraft(c, value, makeId = () => g.crypto.randomUUID()) {
    const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {id: typeof saved.id === 'string' && saved.id.trim() ? saved.id : makeId(),
      notes: typeof saved.notes === 'string' ? saved.notes : '',
      ...(Object.hasOwn(followupLabels, saved.followup) ? {followup:saved.followup} : {}),
      ...(Object.hasOwn(precheckLabels, saved.precheck) ? {precheck:saved.precheck} : {}),
      ...(typeof saved.biopsy === 'string' && saved.biopsy ? {biopsy:saved.biopsy} : {}),
      ...(saved.visitRequest === true ? {visitRequest:true} : {}),
      ...normalizeReferences(c, saved.selected, saved.none),
      ...(['auto','basic'].includes(saved.viewpointChoice) ? {viewpointChoice:saved.viewpointChoice} : {}),
      ...(saved.viewpoint != null ? {viewpoint:clone(saved.viewpoint)} : {})};
  }
  const compareVersion = 'lits-model-compare-v1';
  const stable = value => JSON.stringify(value, function(key, v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v;
  });
  function localDemoEnvelope(c, context, optedIn) {
    const canonical = context?.cases?.find(item => item.id === c.id);
    if (optedIn !== true || c.synthetic || !canonical || stable(canonical) !== stable(c) ||
        context.manifestVersion !== compareVersion || !/^[a-f0-9]{64}$/.test(context.manifestSha256) ||
        c.id !== c.sourceCaseId || !c.slices?.length) throw Error('Explicit local research DEMO consent and canonical binding required');
    // Separate envelope: never add a patient mapping or DEMO identity to c.
    return {kind:'research-local-demo-v1', consent:'LOCAL_DEMO', case:clone(canonical), evidenceContext:clone(context.evidenceContext||null),
      binding:{manifestSha256:context.manifestSha256, manifestVersion:context.manifestVersion, sourceCaseId:c.id}};
  }
  // Canvas pan uses 512px logical coordinates, independent of CSS size.
  function validateViewpoint(v, c, binding) {
    if (v == null) return null; // Legacy/basic view.
    if (v.version !== 'md-viewpoint-v1' || v.caseId !== c.id ||
        !binding || v.manifestSha256 !== binding.manifestSha256 ||
        !/^[a-f0-9]{64}$/.test(v.manifestSha256) || binding.sourceCaseId !== c.id ||
        !Number.isInteger(v.slice) || v.slice < 0 || v.slice >= c.slices.length ||
        !['zoom','panX','panY','contrast'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k])) ||
        v.zoom < 1 || v.zoom > 5 || Math.abs(v.panX) > 2048 || Math.abs(v.panY) > 2048 ||
        v.contrast < .2 || v.contrast > 3 ||
        (Object.hasOwn(v,'overlayMode') && !['seg','outline','box'].includes(v.overlayMode)) ||
        (Object.hasOwn(v,'overlayVisible') && typeof v.overlayVisible !== 'boolean')) throw Error('Invalid sender viewpoint');
    return {...Object.fromEntries(['version','caseId','manifestSha256','slice','zoom','panX','panY','contrast'].map(k=>[k,v[k]])),
      ...(Object.hasOwn(v,'overlayMode') ? {overlayMode:v.overlayMode} : {}),
      ...(Object.hasOwn(v,'overlayVisible') ? {overlayVisible:v.overlayVisible} : {})};
  }
  function attachViewpoint(frame, c, binding) {
    if (!frame) throw Error('Committed frame required');
    return validateViewpoint({...frame,version:'md-viewpoint-v1',caseId:c.id,manifestSha256:binding?.manifestSha256},c,binding);
  }
  function isLocalRecord(record) {
    return !!record && typeof record.id === 'string' && typeof record.case?.id === 'string' &&
      (record.mode === 'LOCAL_DEMO' || record.mode === 'DEMO' && eligible(record.case));
  }
  function recordLink(scope, id, mode='sent') {
    return 'recipient.html#' + new URLSearchParams({mode:mode==='inbox'?'inbox':'sent',scope,record:id}).toString();
  }
  async function snapshotCase(record, manifestText, validateManifest, scope) {
    if (record.mode !== 'LOCAL_DEMO' || record.dataKind !== 'research-ct' ||
        !record.binding || record.scope !== scope || record.binding.manifestSha256 !== scope ||
        await digest(manifestText) !== record.binding.manifestSha256) throw Error('Live manifest binding mismatch');
    const manifest = JSON.parse(manifestText);
    const cases = validateManifest(manifest);
    const canonical = cases.find(c => c.id === record.binding.sourceCaseId);
    if (manifest.version !== compareVersion || manifest.version !== record.binding.manifestVersion ||
        !canonical || canonical.id !== record.case.id || stable(canonical) !== stable(record.case) ||
        !selection(canonical, record.selected, record.none)) throw Error('Snapshot identity or reference mismatch');
    validateViewpoint(record.viewpoint, canonical, record.binding);
    // Only return live validated local paths, never paths supplied by storage.
    return clone(canonical);
  }
  function store(storage, scope) {
    const key = `lesionlens:md:v1:${scope}`;
    function read() {
      const raw = storage.getItem(key);
      if (!raw) return {reviews:{}, drafts:{}, sends:{}, receipts:{}};
      const state = JSON.parse(raw);
      if (!state.reviews || !state.drafts || !state.sends || !state.receipts) throw Error('Invalid local records');
      return state;
    }
    function write(fn) {
      const state = read(); fn(state);
      const raw = JSON.stringify(state); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('Persistent acknowledgement failed');
      return state;
    }
    return {key, read, review(id, value) { return write(s => { s.reviews[id] = value; }); },
      draft(id, draft) { return write(s => { s.drafts[id] = clone(draft); }); },
      discard(id) { return write(s => { delete s.drafts[id]; }); },
      send(c, draft, evidence, mode, envelope=null) {
        const research = mode === 'LOCAL_DEMO';
        if (research) {
          if (envelope?.kind !== 'research-local-demo-v1' || envelope.consent !== 'LOCAL_DEMO' ||
              envelope.binding?.manifestSha256 !== scope || !/^[a-f0-9]{64}$/.test(scope) ||
              envelope.binding.manifestVersion !== compareVersion || envelope.binding.sourceCaseId !== c.id ||
              c.synthetic || !c.slices?.length || stable(envelope.case) !== stable(c)) throw Error('Explicit local research DEMO envelope required');
        } else if (mode !== 'DEMO' || !eligible(c)) throw Error('Approved DEMO mapping required');
        if (!selection(c, draft.selected, draft.none) || typeof draft.id !== 'string' || !draft.id.trim() || typeof draft.notes !== 'string') throw Error('Invalid selection');
        const viewpoint = validateViewpoint(draft.viewpoint, c, research ? envelope.binding : null);
        if (draft.followup !== undefined && (typeof draft.followup !== 'string' || !followupOptions.includes(draft.followup))) throw Error('Invalid followup opinion');
        if (draft.precheck !== undefined && (typeof draft.precheck !== 'string' || !precheckOptions.includes(draft.precheck))) throw Error('Invalid pre-opinion record');
        // A biopsy target must be a candidate of this case at this moment; an unknown
        // id fails closed instead of storing a pointer that later resolves to nothing.
        const candidates = reviewCandidates(evidence);
        let biopsyCandidate;
        if (draft.biopsy !== undefined) {
          const hit = candidates.find(k => k.candidateId === draft.biopsy);
          if (!hit) throw Error('Invalid biopsy candidate');
          biopsyCandidate = {candidateId:hit.candidateId, model:hit.model, voxel:hit.voxel.slice(), slice:hit.slice, small:hit.small};
        }
        const visit = visitStatus(c);
        if (draft.visitRequest !== undefined && draft.visitRequest !== true) throw Error('Invalid outpatient request');
        if (draft.visitRequest === true && visit !== 'scheduled_not_visited') throw Error('Outpatient request requires a not-visited case');
        const existing = read().sends[draft.id];
        if (existing) {
          if (existing.case.id !== c.id || existing.mode !== mode) throw Error('Idempotency conflict');
          return existing;
        }
        const record = {id:draft.id, mode, scope, dataKind:research?'research-ct':'synthetic-no-ct', case:clone(c), selected:clone(draft.selected), none:draft.none,
          ...(draft.followup !== undefined ? {followup:draft.followup} : {}),
          ...(draft.precheck !== undefined ? {precheck:draft.precheck} : {}),
          ...(biopsyCandidate ? {biopsyCandidate} : {}),
          visit:{status:visit, requested:draft.visitRequest === true},
          priorStudy:research ? priorStudyFor(c) : null,
          viewpoint, notes:draft.notes, evidence:clone(evidence || null), summary:'생성형 AI 소견 없음',
          sender:research?'LOCAL DEMO MD':'DEMO MD', time:new Date().toISOString(),
          recipient:research?{role:'LOCAL DEMO 임상 담당자',demo:true,patientMapping:null}:clone(c.mapping),
          binding:research?clone(envelope.binding):null,
          evidenceContext:research&&evidence?clone(envelope.evidenceContext||null):null,
          demoLink:research?{kind:envelope.kind,sourceCaseId:c.id,consent:'LOCAL_DEMO',clinicalTransport:false}:null};
        // One acknowledged persistent write commits both status and recipient snapshot.
        write(s => { s.sends[record.id] = record; s.reviews[c.id] = true; delete s.drafts[c.id]; });
        return record;
      },
      receipt(id) { return write(s => { if (!isLocalRecord(s.sends[id])) throw Error('Missing DEMO record'); s.receipts[id] ||= new Date().toISOString(); }); }
    };
  }
  // Evidence repeats one row per disagreeing model pair, which buries the list on
  // cases with many candidates. Reviewers act on a candidate, not on a pair, so the
  // list collapses by candidateId and keeps the counterpart models for detail.
  function reviewCandidates(e) {
    if (!e || !Array.isArray(e.reasons)) return [];
    const byId = new Map();
    for (const r of e.reasons) {
      if (!r || typeof r.candidateId !== 'string' || !r.candidateId) continue;
      let item = byId.get(r.candidateId);
      if (!item) {
        item = {candidateId:r.candidateId, model:typeof r.model === 'string' ? r.model : null,
          voxel:Array.isArray(r.voxel) ? r.voxel.slice(0,3) : [],
          slice:Number.isInteger(r.slice) ? r.slice : null, small:!!r.smallAdditional, pairs:[]};
        byId.set(r.candidateId, item);
      }
      if (typeof r.otherModel === 'string' && !item.pairs.includes(r.otherModel)) item.pairs.push(r.otherModel);
      if (r.smallAdditional) item.small = true;
    }
    return [...byId.values()].sort((a,b) => (a.slice ?? 0) - (b.slice ?? 0) || a.candidateId.localeCompare(b.candidateId));
  }
  function candidateLabel(item) {
    if (!item) return '';
    const slice = item.slice === null ? '절편 알 수 없음' : `절편 ${item.slice + 1}`;
    return `${item.candidateId} · ${slice}${item.small ? ' · 작은 추가 후보' : ''}`;
  }
  // Demo-only visit scenario. Derived from the case id so a reload cannot change it
  // mid-demo; this is never real patient data and never leaves the browser.
  const visitOptions = ['visited_today','scheduled_not_visited','no_visit'];
  const visitLabels = {visited_today:'금일 내원 확인', scheduled_not_visited:'금일 외래 미내원', no_visit:'내원 일정 없음'};
  function visitLabel(value) {
    if (value === undefined) return '이 전송에는 내원 정보 기록이 없습니다.';
    if (typeof value !== 'string' || !Object.hasOwn(visitLabels, value)) return '읽을 수 없는 내원 정보';
    return visitLabels[value];
  }
  function visitStatus(c) {
    if (!c || typeof c.id !== 'string' || !c.id) return 'no_visit';
    let hash = 2166136261;
    for (const ch of c.id) hash = ((hash ^ ch.codePointAt(0)) * 16777619) >>> 0;
    return visitOptions[hash % visitOptions.length];
  }
  // Prior-study pairing for the local demo. LL-CT-001 is a slice-window crop of the
  // same LiTS source volume as case_000 (see data/real_cases/LOCAL_PROVENANCE.json),
  // so it is a real derived pair, but it is NOT a verified earlier exam of a patient
  // and every acquisition date here is a demo placeholder. The integrated server's
  // exact asset allowlist does not publish data/real_cases yet, so the receiver side
  // shows this pairing as metadata and refuses to open the images rather than
  // substituting another case's CT.
  const priorStudies = {
    case_000:{alias:'LL-CT-001', manifestPath:'data/real_cases/manifest.json',
      basis:'같은 원본 볼륨(sourceCaseId 000)에서 절편 50–73만 잘라 만든 시연용 짝 · 환자 검사가 아님',
      assumedDate:'2026-05-14'}
  };
  function priorStudyFor(c) {
    const entry = c && priorStudies[c.id];
    if (!entry) return null;
    return {kind:'demo-prior-study-v1', caseId:c.id, alias:entry.alias, manifestPath:entry.manifestPath,
      basis:entry.basis, assumedDate:entry.assumedDate, dateIsAssumed:true};
  }
  function biopsyCandidateLabel(v) {
    if (v === undefined) return '이 전송에는 조직검사 후보가 기록되지 않았습니다.';
    if (!v || typeof v.candidateId !== 'string' || !v.candidateId) return '읽을 수 없는 조직검사 후보';
    const slice = Number.isInteger(v.slice) ? `절편 ${v.slice + 1}` : '절편 알 수 없음';
    return `${v.candidateId} · ${slice}${v.small ? ' · 작은 추가 후보' : ''}`;
  }
  function reason(e) {
    if (!e) return '모델 비교 근거 미산출';
    if (e.pairs && !e.pairs.length) return '모델 비교 근거 미산출 · 비교 가능한 모델 2종 미만';
    if (e.reasons.length) return '모델 간 불일치' + (e.reasons.some(r => r.smallAdditional) ? ' · 작은 추가 후보' : '');
    return e.missingModels.length ? '비교 자료 일부 없음 · 사용 가능한 모델 사이 불일치 미검출' : '잠정 규칙상 불일치 미검출 · 일치 ≠ 정확';
  }
  function queue(cases, evidence, state, filter='pending', search='') {
    const sent = new Set(Object.values(state.sends).map(r => r.case.id));
    return cases.filter(c => c.id.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || filter === 'pending' && !state.reviews[c.id] || filter === 'reviewed' && state.reviews[c.id] || filter === 'sent' && sent.has(c.id)))
      .sort((a,b) => Number(!!evidence[b.id]?.reasons.length) - Number(!!evidence[a.id]?.reasons.length) || a.id.localeCompare(b.id));
  }
  async function digest(text) {
    const hash = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
  }
  const api = {followupOptions,followupLabels,followupLabel,precheckOptions,precheckLabels,precheckLabel,reviewCandidates,candidateLabel,biopsyCandidateLabel,
    visitOptions,visitLabels,visitLabel,visitStatus,priorStudies,priorStudyFor,validateViewpoint,attachViewpoint,labels,models,demo,eligible,availableModel,selection,normalizeReferences,normalizeDraft,localDemoEnvelope,isLocalRecord,recordLink,snapshotCase,store,reason,queue,digest};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.MD = api;
})(globalThis);

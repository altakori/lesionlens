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
        const existing = read().sends[draft.id];
        if (existing) {
          if (existing.case.id !== c.id || existing.mode !== mode) throw Error('Idempotency conflict');
          return existing;
        }
        const record = {id:draft.id, mode, scope, dataKind:research?'research-ct':'synthetic-no-ct', case:clone(c), selected:clone(draft.selected), none:draft.none,
          ...(draft.followup !== undefined ? {followup:draft.followup} : {}),
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
  const api = {followupOptions,followupLabels,followupLabel,validateViewpoint,attachViewpoint,labels,models,demo,eligible,availableModel,selection,normalizeReferences,normalizeDraft,localDemoEnvelope,isLocalRecord,recordLink,snapshotCase,store,reason,queue,digest};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.MD = api;
})(globalThis);

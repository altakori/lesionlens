/* Local DEMO workflow. No network transport or real patient mapping. */
(function (g) {
  'use strict';
  const labels = {gt:'GT', cappyv2:'CAPPY2 current', cp050:'CAPPY2 050', baseline:'Baseline'};
  const models = ['cappyv2','cp050','baseline'];
  const followupOptions = ['short_term_followup','immediate_us_biopsy','other','none'];
  const followupLabels = {short_term_followup:'단기 추적검사', immediate_us_biopsy:'즉시 조직검사 · 프로토콜 선택', other:'기타(직접 입력)', none:'의견 없음'};
  function followupLabel(value) {
    if (value === undefined) return '이 전송에는 의견 기록이 없습니다.';
    if (typeof value !== 'string' || !Object.hasOwn(followupLabels, value)) return '읽을 수 없는 의견 유형';
    return followupLabels[value];
  }
  const followupModalityOptions = ['mri_gadolinium','mri_hepatobiliary','ct_dynamic','ct_noncontrast','pet_ct','ceus','b_mode_us'];
  const followupModalityLabels = {
    mri_gadolinium:'역동적 조영증강 MRI · 가돌리늄 기반 조영제',
    mri_hepatobiliary:'역동적 조영증강 MRI · 간담도 조영제',
    ct_dynamic:'역동적 조영증강 CT', ct_noncontrast:'비조영 CT',
    pet_ct:'PET-CT', ceus:'조영증강 초음파(CEUS)', b_mode_us:'B-mode 초음파'
  };
  function followupModalityLabel(value) {
    if (value === undefined) return '검사 방법 미지정';
    return typeof value === 'string' && Object.hasOwn(followupModalityLabels,value)
      ? followupModalityLabels[value] : '읽을 수 없는 추적검사 방법';
  }
  const biopsyProtocolOptions = ['us','ct','mri','surgical'];
  const biopsyProtocolLabels = {us:'초음파(US) 유도', ct:'CT 유도', mri:'MRI 유도', surgical:'수술실 생검'};
  function biopsyProtocolLabel(value) {
    if (value === undefined) return '이 전송에는 조직검사 프로토콜이 기록되지 않았습니다.';
    if (typeof value !== 'string' || !Object.hasOwn(biopsyProtocolLabels, value)) return '읽을 수 없는 프로토콜';
    return biopsyProtocolLabels[value];
  }
  const biopsyProtocolGuides = {
    us:{title:'초음파(US) 유도 조직검사', fit:'간·경부·표재성 병변처럼 초음파로 보이는 부위',
      steps:['병변 접근 경로와 실시간 관찰 가능 여부를 영상에서 확인','항혈전제·항응고제 복용력과 응고 상태는 담당 주치의가 확인','환자 설명·동의 절차와 시술 부위 체위 안내','초음파 프로브·생검총 준비 및 무균 절차','시술 후 압박·출혈 관찰과 병리 의뢰 경로 공유'],
      confirm:'초음파실 운영 시간, 장비 배정, 시술 가능 인력은 기관 확인 필요'},
    ct:{title:'CT 유도 조직검사', fit:'폐·복막후·골 병변처럼 초음파로 보이지 않는 부위',
      steps:['저선량 위치 확인 스캔 후 바늘 경로 계획','호흡 정지 지시가 필요한 부위는 사전에 환자 교육','피폭 선량은 기관 프로토콜 기준으로 계산','시술 직후 영상에서 기흉·출혈 여부 확인','검체 운반 경로와 결과 회송 일정 공유'],
      confirm:'CT실 사용 가능 시간대, 물리사 배정, 회복 관찰 병상은 기관 확인 필요'},
    mri:{title:'MRI 유도 조직검사', fit:'조영 증강 양상이 중요한 유방·전립선·골반 병변',
      steps:['MRI 호환 장비와 비자성 세트 확인','조영제 투여 가능 여부와 신기능은 담당 주치의가 확인','폐소공·메탈 클립 등 MRI 금기 여부 사전 점검','장시간 검사 대비 체위·소음 안내','검체 식별자와 영상 시점 연결 확인'],
      confirm:'MRI 유도 시술 가능 여부·장비·적응증은 해당 기관에서 확인 필요'},
    surgical:{title:'수술실 생검·절제 생검', fit:'영상 유도 생검이 어렵거나 치료적 절제를 함께 계획하는 경우',
      steps:['외과·마취과 사전 상담 및 마취 평가','금식 시간과 입원 일정은 기관 지침에 따름','병변 위치 표시(태깅) 필요 여부를 영상의학과와 협의','수술 후 병리 결과 회송 경로 확정','항혈전제 중단 여부는 담당 주치의 판단'],
      confirm:'수술실 배정, 마취과 평가 일정, 병상 상황은 기관 확인 필요'}
  };
  function protocolGuide(value) {
    if (typeof value !== 'string' || !Object.hasOwn(biopsyProtocolGuides, value)) return null;
    const one = biopsyProtocolGuides[value];
    return {kind:'demo-protocol-guide-v1', key:value, label:biopsyProtocolLabels[value], title:one.title,
      fit:one.fit, steps:one.steps.slice(), confirm:one.confirm, authority:'시연용 일반 안내 · 이 병원의 실제 프로토콜 문서 아님'};
  }
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
    const valid = none === true || !Array.isArray(selected) ? [] : models.filter(k => selected.includes(k) && availableModel(c, k));
    return {selected: valid, none: valid.length === 0};
  }
  function normalizeDraft(c, value, makeId = () => g.crypto.randomUUID()) {
    const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {id: typeof saved.id === 'string' && saved.id.trim() ? saved.id : makeId(),
      notes: typeof saved.notes === 'string' ? saved.notes : '',
      ...(Object.hasOwn(followupLabels, saved.followup) ? {followup:saved.followup} : {}),
      ...(saved.followup === 'short_term_followup' && typeof saved.followupModality === 'string' && Object.hasOwn(followupModalityLabels,saved.followupModality) ? {followupModality:saved.followupModality} : {}),
      ...(Object.hasOwn(precheckLabels, saved.precheck) ? {precheck:saved.precheck} : {}),
      ...(typeof saved.biopsy === 'string' && saved.biopsy ? {biopsy:saved.biopsy} : {}),
      ...(Object.hasOwn(biopsyProtocolLabels, saved.biopsyProtocol) ? {biopsyProtocol:saved.biopsyProtocol} : {}),
      ...(saved.visitRequest === true ? {visitRequest:true} : {}),
      ...normalizeReferences(c, saved.selected, saved.none),
      ...(['auto','basic'].includes(saved.viewpointChoice) ? {viewpointChoice:saved.viewpointChoice} : {}),
      ...(saved.viewpoint != null ? {viewpoint:clone(saved.viewpoint)} : {})};
  }
  const compareVersion = 'lits-public-demo-v1';
  const stable = value => JSON.stringify(value, function(key, v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v;
  });
  function localDemoEnvelope(c, context, optedIn) {
    const canonical = context?.cases?.find(item => item.id === c.id);
    if (optedIn !== true || c.synthetic || !canonical || stable(canonical) !== stable(c) ||
        context.manifestVersion !== compareVersion || !/^[a-f0-9]{64}$/.test(context.manifestSha256) ||
        c.id !== c.sourceCaseId || !c.slices?.length) throw Error('Explicit local research DEMO consent and canonical binding required');
    return {kind:'research-local-demo-v1', consent:'LOCAL_DEMO', case:clone(canonical), evidenceContext:clone(context.evidenceContext||null),
      binding:{manifestSha256:context.manifestSha256, manifestVersion:context.manifestVersion, sourceCaseId:c.id}};
  }
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
        if (draft.followupModality !== undefined && (draft.followup !== 'short_term_followup' || typeof draft.followupModality !== 'string' || !followupModalityOptions.includes(draft.followupModality))) throw Error('Invalid followup modality');
        if (draft.precheck !== undefined && (typeof draft.precheck !== 'string' || !precheckOptions.includes(draft.precheck))) throw Error('Invalid pre-opinion record');
        const candidates = reviewCandidates(evidence);
        let biopsyCandidate;
        if (draft.biopsy !== undefined) {
          const hit = candidates.find(k => k.candidateId === draft.biopsy);
          if (!hit) throw Error('Invalid biopsy candidate');
          biopsyCandidate = {candidateId:hit.candidateId, model:hit.model, voxel:hit.voxel.slice(), slice:hit.slice, small:hit.small};
        }
        let biopsyProtocol;
        if (draft.followup === 'immediate_us_biopsy') {
          if (typeof draft.biopsyProtocol !== 'string' || !biopsyProtocolOptions.includes(draft.biopsyProtocol)) throw Error('Biopsy opinion requires a guidance protocol');
          biopsyProtocol = draft.biopsyProtocol;
        } else if (draft.biopsyProtocol !== undefined) throw Error('Invalid biopsy protocol');
        const visit = visitStatus(c);
        if (draft.visitRequest !== undefined && draft.visitRequest !== true) throw Error('Invalid outpatient request');
        if (draft.visitRequest === true && visit !== 'scheduled_not_visited' && !syntheticPairFor(c.id)) throw Error('Outpatient request requires a not-visited case');
        const existing = read().sends[draft.id];
        if (existing) {
          if (existing.case.id !== c.id || existing.mode !== mode) throw Error('Idempotency conflict');
          return existing;
        }
        const record = {id:draft.id, mode, scope, dataKind:research?'research-ct':'synthetic-no-ct', case:clone(c), selected:clone(draft.selected), none:draft.none,
          ...(draft.followup !== undefined ? {followup:draft.followup} : {}),
          ...(draft.followupModality !== undefined ? {followupModality:draft.followupModality} : {}),
          ...(draft.precheck !== undefined ? {precheck:draft.precheck} : {}),
          ...(biopsyCandidate ? {biopsyCandidate} : {}),
          ...(biopsyProtocol ? {biopsyProtocol} : {}),
          visit:{status:visit, requested:draft.visitRequest === true},
          priorStudy:research ? priorStudyFor(c) : null, series:research ? seriesFor(c) : null,
          viewpoint, notes:draft.notes, evidence:clone(evidence || null), summary:'생성형 AI 소견 없음',
          sender:research?'LOCAL DEMO MD':'DEMO MD', time:new Date().toISOString(),
          recipient:research?{role:'LOCAL DEMO 임상 담당자',demo:true,patientMapping:null}:clone(c.mapping),
          binding:research?clone(envelope.binding):null,
          evidenceContext:research&&evidence?clone(envelope.evidenceContext||null):null,
          demoLink:research?{kind:envelope.kind,sourceCaseId:c.id,consent:'LOCAL_DEMO',clinicalTransport:false}:null};
        write(s => { s.sends[record.id] = record; s.reviews[c.id] = true; delete s.drafts[c.id]; });
        return record;
      },
      receipt(id) { return write(s => { if (!isLocalRecord(s.sends[id])) throw Error('Missing DEMO record'); s.receipts[id] ||= new Date().toISOString(); }); }
    };
  }
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
  const seriesManifestPath = 'data/model_compare/manifest.json';
  const seriesRelations = {prior:'이전 CT', current:'이 검사', next:'다음 CT'};
  const studyReceipts = [
    {alias:'case_065', manifestPath:seriesManifestPath, sourceCaseId:'case_065', imageSha256:'6b3756f77a3075e2c45f549b924f46be4a507c1d8c0ac2e347bbf35c3d543bfa'},
    {alias:'case_083', manifestPath:seriesManifestPath, sourceCaseId:'case_083', imageSha256:'e0fdcea24bed84286ebc79ab4fbfc95bae65d8011aac5f9101a7ec13a01d0bb9'},
    {alias:'case_129', manifestPath:seriesManifestPath, sourceCaseId:'case_129', imageSha256:'cf0947b317635fec5de8abc19cb3b169a7cf4efc85a09da59437584fbff330cf'},
    {alias:'lv2-case_117', manifestPath:seriesManifestPath, sourceCaseId:'case_117', imageSha256:'26faffeb4a3137274ed7d8f5da070187d3924baf50c724b8f234135a7716ae75'},
    {alias:'lv2-case_118', manifestPath:seriesManifestPath, sourceCaseId:'case_118', imageSha256:'9e74a55f74b99c019617f422e14457ea580a357d797dada9ebfda6174d400667'},
    {alias:'lv2-case_125', manifestPath:seriesManifestPath, sourceCaseId:'case_125', imageSha256:'843c0c42803744f1b137b7559e3277eb3367b08ca8077fb251a3251ddae4b3bb'},
  ];
  const syntheticSeriesGroups = [
    {patientId:'DEMO-SERIES-1', prior:'case_065', current:'lv2-case_117', intervalMonths:7, priorGt:'0.5', currentGt:'382.5'},
    {patientId:'DEMO-SERIES-2', prior:'lv2-case_125', current:'case_129', intervalMonths:14, priorGt:'0.6', currentGt:'664.6'},
    {patientId:'DEMO-SERIES-3', prior:'case_083', current:'lv2-case_118', intervalMonths:5, priorGt:'0.04', currentGt:'348.1'},
  ];
  const syntheticSeriesLabel = '합성 구성 · 실제 환자의 경과 아님';
  const gtLabel = cm3 => `GT 병변 ${cm3}cm³`;
  function syntheticSeriesFor(alias) {
    const hit = syntheticSeriesGroups.find(g => g.prior === alias || g.current === alias);
    if (!hit) return null;
    const asPrior = hit.current === alias;
    const other = asPrior ? hit.prior : hit.current;
    const receipt = studyReceipt(other);
    return {patientId:hit.patientId, relation:asPrior ? 'prior' : 'next', other,
      assumedDate:`약 ${hit.intervalMonths}개월 ${asPrior ? '전' : '후'}`,
      gtBasis:`GT 병변 ${hit.priorGt}cm³ → ${hit.currentGt}cm³`,
      otherGt:asPrior ? hit.priorGt : hit.currentGt, selfGt:asPrior ? hit.currentGt : hit.priorGt,
      viewable:!!receipt && receipt.manifestPath === seriesManifestPath};
  }
  function syntheticPairFor(alias) {
    const hit = syntheticSeriesGroups.find(g => g.prior === alias || g.current === alias);
    return hit || null;
  }
  function studyReceipt(alias) { return studyReceipts.find(r => r.alias === alias) || null; }
  function duplicateStudies(c) {
    const r = studyReceipt(c && c.id);
    if (!r) return [];
    return studyReceipts.filter(x => x !== r && x.imageSha256 === r.imageSha256)
      .map(x => ({alias:x.alias, manifestPath:x.manifestPath, sourceCaseId:x.sourceCaseId,
        reason:'image sha256 동일'}));
  }
  function studyIdentityKey(c) {
    const r = studyReceipt(c && c.id);
    return r ? 'sha:' + r.imageSha256 : 'unknown:' + (c && c.id);
  }
  function seriesFor(c) {
    if (!c || c.synthetic || typeof c.id !== 'string' || !c.id) return null;
    const r = studyReceipt(c.id);
    const syn = syntheticSeriesFor(c.id);
    const current = {alias:c.id, relation:'current', label:seriesRelations.current,
      viewable:!r || r.manifestPath === seriesManifestPath, gtVolume:syn ? gtLabel(syn.selfGt) : null};
    const other = syn ? {alias:syn.other, relation:syn.relation, label:seriesRelations[syn.relation],
      assumedDate:syn.assumedDate, viewable:syn.viewable, gtVolume:gtLabel(syn.otherGt)} : null;
    const studies = !syn ? [current] : syn.relation === 'prior' ? [other, current] : [current, other];
    return {kind:'study-series-v2', patientId:syn ? syn.patientId : null,
      patientIdBasis:syn ? '합성 구성 · 실제 환자 키 아님' : 'Dataset003_Liver는 환자당 CT 1건 · 환자 키 없음',
      syntheticSeries:!!syn, gtBasis:syn ? syn.gtBasis : null,
      basis:syn ? `${syntheticSeriesLabel} · GT 병변 부피 순으로 서로 다른 검사를 짝지음(${syn.gtBasis})`
        : '검사 식별은 image sha256 receipt 기준 · 같은 환자의 다른 검사는 이 데이터셋에 없음',
      currentIndex:studies.findIndex(s => s.relation === 'current'),
      studies, duplicates:duplicateStudies(c)};
  }
  function seriesSummary(c) {
    const s = seriesFor(c);
    if (!s) return '';
    if (s.syntheticSeries) {
      const other = s.studies.find(k => k.relation !== 'current');
      return `합성 시리즈 ${s.studies.length}건 · ${other.label} 1건 · 실제 환자의 경과 아님`;
    }
    return s.duplicates.length
      ? `이 검사 1건 · 같은 검사의 복제 표시 ${s.duplicates.map(d => d.alias).join(', ')}`
      : '이 검사 1건 · 이전·다음 검사 미확인';
  }
  function priorStudyFor(c) { return null; }
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
  const queueFilters = ['pending','reviewed','sent','series','demo','all'];
  const queueFilterLabels = {pending:'미검토', reviewed:'검토 완료', sent:'전송됨',
    series:'검사 시리즈', demo:'시연 순서', all:'전체'};
  const demoSeriesIds = new Set(syntheticSeriesGroups.flatMap(g => [g.prior, g.current]));
  function filterCounts(cases, evidence, state, search='') {
    const out = {};
    for (const f of queueFilters) out[f] = queue(cases, evidence, state, f, search).length;
    return out;
  }
  function queue(cases, evidence, state, filter='pending', search='') {
    const sent = new Set(Object.values(state.sends).map(r => r.case.id));
    const ordered = cases.filter(c => c.id.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || filter === 'pending' && !state.reviews[c.id] || filter === 'reviewed' && state.reviews[c.id] ||
       filter === 'sent' && sent.has(c.id) ||
       filter === 'series' && !!syntheticPairFor(c.id) && !c.synthetic ||
       filter === 'demo' && (c.synthetic === true || demoSeriesIds.has(c.id))))
      .sort((a,b) => Number(!!evidence[b.id]?.reasons.length) - Number(!!evidence[a.id]?.reasons.length) || a.id.localeCompare(b.id));
    const seen = new Set();
    const deduped = ordered.filter(c => { const key = studyIdentityKey(c); if (seen.has(key)) return false; seen.add(key); return true; });
    const byId = new Map(deduped.map(c => [c.id, c]));
    const out = []; const placed = new Set();
    for (const c of deduped) {
      if (placed.has(c.id)) continue;
      const pair = syntheticPairFor(c.id);
      if (!pair) { placed.add(c.id); out.push(c); continue; }
      for (const id of [pair.prior, pair.current]) {
        if (placed.has(id) || !byId.has(id)) continue;
        placed.add(id); out.push(byId.get(id));
      }
    }
    return out.filter(c => !c.synthetic).concat(out.filter(c => c.synthetic));
  }
  function patientQueue(cases, evidence, state, filter='all', search='') {
    const unique=queue(cases,evidence,state,'all',''), seen=new Set(), rows=[];
    const byId=new Map(unique.map(c=>[c.id,c]));
    for(const c of unique) {
      const group=syntheticPairFor(c.id), key=group?'demo:'+group.patientId:studyIdentityKey(c);
      if(seen.has(key))continue;seen.add(key);
      const studies=group?[group.prior,group.current].map(id=>byId.get(id)).filter(Boolean):[c];
      rows.push({key,group:group||null,current:group?(byId.get(group.current)||studies.at(-1)):c,studies});
    }
    rows.sort((a,b)=>Number(!!evidence[b.current.id]?.reasons.length)-Number(!!evidence[a.current.id]?.reasons.length)
      ||Number(!!a.current.synthetic)-Number(!!b.current.synthetic)||a.current.id.localeCompare(b.current.id));
    const sent=new Set(Object.values(state.sends).map(r=>r.case.id));
    const term=String(search).trim().toLowerCase();
    return rows.map((r,i)=>({...r,number:i+1})).filter(r=>
      (!term||String(r.number)===term||r.studies.some(c=>c.id.toLowerCase().includes(term)))&&
      (filter==='all'||filter==='pending'&&!state.reviews[r.current.id]||filter==='reviewed'&&!!state.reviews[r.current.id]
        ||filter==='sent'&&sent.has(r.current.id)));
  }
  async function digest(text) {
    const hash = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
  }
  const api = {followupOptions,followupLabels,followupLabel,followupModalityOptions,followupModalityLabels,followupModalityLabel,precheckOptions,precheckLabels,precheckLabel,reviewCandidates,candidateLabel,biopsyCandidateLabel,
    visitOptions,visitLabels,visitLabel,visitStatus,studyReceipts,syntheticSeriesGroups,duplicateStudies,studyIdentityKey,priorStudyFor,
    biopsyProtocolOptions,biopsyProtocolLabels,biopsyProtocolLabel,protocolGuide,seriesFor,seriesSummary,
    seriesGroupFor:syntheticPairFor,queueFilters,queueFilterLabels,filterCounts,seriesRelations,validateViewpoint,attachViewpoint,labels,models,demo,eligible,availableModel,selection,normalizeReferences,normalizeDraft,localDemoEnvelope,isLocalRecord,recordLink,snapshotCase,store,reason,queue,patientQueue,digest};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.MD = api;
})(globalThis);

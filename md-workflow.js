(async function(g){
  'use strict';
  const M=g.MD, doc=document, root=doc.getElementById('mdQueue');if(!root)return;
  const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=doc.getElementById('mdStatus'), list=doc.getElementById('mdList'), filter=doc.getElementById('mdFilter'), search=doc.getElementById('mdSearch');
  const tabs=doc.getElementById('mdFilterTabs');
  let cases=[M.demo], evidence={}, records, state, views=[], sourceContext=null;
  const say=t=>{status.textContent=t;};
  let scope='demo-only-v1';
  try{
    const response=await fetch('/data/model_compare/manifest.json',{cache:'no-store'});if(!response.ok)throw Error();
    const text=await response.text(), raw=JSON.parse(text), actual=normalizeManifest(raw);if(!actual.length)throw Error();
    scope=await M.digest(text);cases=[...actual,M.demo];sourceContext={manifestSha256:scope,manifestVersion:raw.version,cases:actual};
    try{const r=await fetch('/data/model_compare/evidence.json',{cache:'no-store'});if(r.ok){const e=await r.json();if(e.version==='md-evidence-v1'&&e.manifestSha256===scope&&e.rules.clinicalValidation===false){evidence=e.cases;sourceContext.evidenceContext={version:e.version,manifestSha256:e.manifestSha256,rules:e.rules};}}}catch(_){}
    say('모델 후보 비교 · GT는 이유/정렬에서 제외됩니다.');
  }catch(_){say('실제 CT 자료를 사용할 수 없습니다. 합성 워크플로 시연만 가능합니다.');}
  function readState(){const s=records.read();for(const c of cases){if(!Object.hasOwn(s.reviews,c.id)&&localStorage.getItem(reviewKey(MANIFEST_VERSION,c.id))==='true')s.reviews[c.id]=true;}return s;}
  try{records=M.store(localStorage,scope);state=readState();}catch(_){say('저장소 오류 · 검토/전송 변경 불가');state={reviews:{},sends:{},drafts:{}};}
  function action(label,fn){const b=el('button',label);b.type='button';b.onclick=fn;return b;}
  function refresh(){try{state=readState();render();}catch(_){say('저장소 오류 · 성공으로 처리하지 않았습니다.');}}
  function details(c,e){const d=el('details',null,'md-details');d.append(el('summary','AI 소견·Radiomics'));
    const reasons=el('div',null,'md-reasons');
    if(e?.reasons.length)for(const r of e.reasons)reasons.append(el('p',`${M.labels[r.model]} ${r.candidateId} ↔ ${M.labels[r.otherModel]} · ${r.kind} · canonical RAS voxel [${r.voxel.join(', ')}], 절편 ${r.slice+1}${r.smallAdditional?' · 작은 추가 후보':''}`));
    else reasons.append(el('p',M.reason(e)));d.append(reasons);
    const table=el('table',null,'md-quant-table'), caption=el('caption','전체 3D 연결 성분 후보 · 확진 병변 수 아님');table.append(caption);
    const head=el('tr');for(const t of ['측정 모델','후보 수','최대 후보 mL','전체 후보 mL'])head.append(el('th',t));table.append(head);
    for(const k of M.models){const s=e?.models[k] || c.models[k], row=el('tr');
      const values=s?[M.labels[k],s.componentCount,s.maxVolumeMl??Math.max(0,...s.componentVolumesMl),s.totalVolumeMl??s.volumeMl]:[M.labels[k],'자료 없음','—','—'];
      values.forEach(v=>row.append(el('td',typeof v==='number'?String(Number(v.toFixed(4))):v)));table.append(row);}
    d.append(table,el('p','생성형 AI 소견 없음 · 진단/악성/전이/응급도는 판단하지 않습니다.'),el('p','별도 Radiomics 자료는 아래 보조 영역에서 확인합니다. 데이터셋 자동 매칭 없음.'));
    // The study identity is read most often while reading the AI 신호, so it opens here
    // too. It is a summary of the same receipt, not a second copy of the viewer.
    const sd=seriesSummaryDetails(c);if(sd)d.append(sd);
    return d;}
  // One plain line for the AI 소견 expansion: a second nested fold inside an already
  // folded area is harder to find than the sentence, and it never mounts a viewer.
  function seriesSummaryDetails(c){
    const series=M.seriesFor(c);if(!series)return null;
    const others=series.studies.filter(k=>k.relation!=='current').length;
    const dup=series.duplicates.length
      ? '같은 검사의 다른 별칭(복제)만 확인됩니다: '+series.duplicates.map(x=>x.alias+' · '+x.reason).join(', ')
      : '이 검사 외에 확인할 이전·다음 검사가 이 자료에 없습니다.';
    return el('p','검사 시리즈 · '+series.studies.length+'건 · 이전·다음 '+(others?others+'건':'없음')+' · '+dup+' '
      +series.basis+(series.patientIdBasis?' · '+series.patientIdBasis:'')+' · 경과 판단에 쓰지 마세요','md-details-series');
  }
  // Study list next to the reading controls. Identity comes from the image sha256
  // receipts (MD.studyReceipts), not from a guessed patient, so there are no assumed
  // dates here. A duplicate alias of the same acquisition is named once as text and
  // never mounted as a second study. Studies this server does not publish fail closed.
  function seriesBlock(c){
    const series=M.seriesFor(c);
    // The synthetic workflow case has no CT at all, so it gets no box rather than an
    // empty framed placeholder.
    if(!series)return null;
    const box=el('div',null,'md-series-wrap');
    const others=series.studies.filter(k=>k.relation!=='current').length;
    const toggle=el('button');toggle.type='button';toggle.className='md-series-toggle';
    toggle.setAttribute('aria-expanded','false');
    toggle.append(el('span',(series.syntheticSeries?'합성 ':'')+'검사 시리즈 · '+series.studies.length+'건 · 이전·다음 '+(others?others+'건':'없음'),'md-series-toggle-label'),el('span','▾','md-series-caret'));
    const body=el('div',null,'md-series-body');body.hidden=true;
    const bar=el('div',null,'md-series');
    const title=el('p',M.seriesSummary(c),'md-series-title');
    const chips=el('div',null,'md-series-chips');
    const note=el('p','','md-series-status');note.setAttribute('role','status');
    const host=el('div',null,'md-series-viewer');host.hidden=true;
    let shown=null;
    function closeStudy(){if(shown){shown.close();shown=null;}host.hidden=true;host.replaceChildren();}
    for(const study of series.studies){
      if(study.relation==='current'){chips.append(el('span',study.label+' · '+study.alias,'md-series-current'));continue;}
      const chip=el('button');
      chip.append(el('span',study.label+' · '+study.alias));
      // The assumed date is duplicated in the note, so narrow widths drop it first.
      if(study.assumedDate)chip.append(el('span',' · '+study.assumedDate+'(가정)','md-series-date'));
      else chip.title=study.alias+' · '+study.label+' · 이 서버가 공개한 자산만 열립니다';
      chip.type='button';chip.className='md-series-chip';chip.dataset.seriesRelation=study.relation;
      chip.onclick=()=>{
        const other=cases.find(x=>x.id===study.alias);
        closeStudy();
        if(!study.viewable||!other){note.textContent=study.alias+' 영상을 이 화면에서 열 수 없습니다. 이 서버가 제공하는 자산 목록에 이 검사가 없습니다. 시리즈 근거와 표시 촬영일은 그대로 남습니다.';return;}
        shown=g.MDViewer.mount(host,other,['ct']);views.push(shown);host.hidden=false;
        host.querySelector('canvas')?.setAttribute('aria-label',study.alias+' '+study.label+' · CT만 표시 · 모델 오버레이 없음 · 방향키 절편 이동');
        if(Number.isInteger(other.defaultSlice))shown.setSlice(other.defaultSlice);
        note.textContent=study.alias+' · '+other.slices.length+'절편 · CT만 표시'+(study.assumedDate?' · 표시 촬영일 '+study.assumedDate+'(가정)':'');
      };
      chips.append(chip);
    }
    // 같은 검사의 복제 별칭은 두 번째 검사가 아니므로 목록에 다시 띄우지 않고 한 줄로만 알린다.
    if(series.duplicates&&series.duplicates.length)chips.append(el('p','같은 검사가 화면에 다시 뜨지 않습니다. 복제 표시: '+series.duplicates.map(d=>d.alias+' · '+d.reason).join(', '),'md-series-dup'));
    bar.append(title,chips,note,el('p',series.basis+(series.patientIdBasis?' · '+series.patientIdBasis:'')+' · 경과 판단에 쓰지 마세요','md-series-note'));
    // The study viewer is a sibling of the status bar, so opening a study never
    // stretches the bar itself.
    toggle.onclick=()=>{const openNow=body.hidden;body.hidden=!openNow;toggle.setAttribute('aria-expanded',String(openNow));caret.textContent=openNow?'▴':'▾';};
    const caret=toggle.querySelector('.md-series-caret');
    body.append(bar);
    box.append(toggle,body,host);
    return box;
  }
  function fmtMl(v){const n=Number(v);return Number(n.toFixed(n<1?3:2));}
  // 2열 요약: 왜 이 CT가 목록에 있는지(불일치 몇 곳)와 규모(가장 큰 후보 몇 mL)만 보인다.
  // 모델별 후보 수·mL·전체 mL는 그대로 아래 AI 소견 표에 남는다.
  function triageStrip(c,e){
    const strip=el('div',null,'md-triage');
    if(!e){strip.append(el('span','AI 비교 근거 미산출','md-stat md-stat-warn'));return strip;}
    const n=e.reasons?e.reasons.length:0;
    strip.append(el('span',n?'불일치 '+n+'곳':'불일치 없음','md-stat'+(n?' md-stat-lead':'')));
    const avail=M.models.map(k=>(e.models&&e.models[k])||(c.models&&c.models[k])).filter(Boolean);
    const sizes=avail.map(m=>Number(m.maxVolumeMl??Math.max(0,...(m.componentVolumesMl||[0])))).filter(Number.isFinite);
    // 모델별 후보 수와 mL은 아래 'AI 소견·Radiomics' 표에 그대로 있다. 카드에는 목록 순서를
    // 읽는 데 쓰는 두 값만 두고 같은 숫자를 두 번 표시하지 않는다(UI_UX_GUIDE 중복 금지).
    if(sizes.length)strip.append(el('span','가장 큰 후보 '+fmtMl(Math.max(...sizes))+' mL','md-stat'));
    return strip;
  }
  // 3열 흐름: 후보 → 검토 → 전송 → 주치의 확인. 상태는 브라우저의 로컬 데모 기록에서만 온다.
  // 실제 진료 전달·수신을 나타내지 않으므로 문구에 그 기준을 남긴다.
  function flowState(c,state){
    const box=el('div',null,'md-flow');
    const receipts=state.receipts||{};
    const sent=Object.values(state.sends).filter(r=>r.case.id===c.id);
    const acked=sent.map(r=>receipts[r.id]).filter(Boolean).sort()[0];
    const meter=el('div',null,'md-flow-meter');meter.setAttribute('aria-hidden','true');
    for(const on of [true,!!state.reviews[c.id],!!sent.length,!!acked])meter.append(el('i',null,on?'on':''));
    const text=acked?('주치의 확인 · '+acked.slice(0,10)):(sent.length?'전송됨 · 주치의 미확인':(state.reviews[c.id]?'검토됨 · 전송 대기':'미검토'));
    box.append(meter,el('p',text,'md-flow-text'));
    box.title='검토 → 전송 → 주치의 확인 · 이 상태는 브라우저의 로컬 데모 기록 기준입니다.';
    return box;
  }
  function seriesHead(g){
    const head=el('div',null,'md-series-head');
    head.append(el('b',g.patientId),el('span','합성 구성 · 실제 환자의 경과 아님'),
      el('span','GT 병변 '+g.priorGt+'cm³ → '+g.currentGt+'cm³ · 약 '+g.intervalMonths+'개월'),
      el('span','이전 검사 → 이 검사 순'));
    return head;
  }
  // 필터 알약은 목록이 실제로 보여주는 개수와 같은 규칙으로 세어야 한다.
  function renderTabs(){
    if(!tabs)return;
    const counts=M.filterCounts(cases,evidence,state,search.value);
    tabs.replaceChildren();
    for(const f of M.queueFilters){
      const b=el('button',M.queueFilterLabels[f]+' '+counts[f],'md-filter-tab');
      b.type='button';b.setAttribute('aria-pressed',String(filter.value===f));
      b.onclick=()=>{filter.value=f;render();};
      tabs.append(b);
    }
  }
  function render(){views.forEach(v=>v.close());views=[];list.replaceChildren();
    const items=M.queue(cases,evidence,state,filter.value,search.value);renderTabs();let lastSeries=null;
    for(const c of items){const e=evidence[c.id], card=el('article',null,'md-case-card');card.dataset.caseId=c.id;
      // 짝이 있는 검사만 시리즈 묶음으로 다룬다. 짝 없는 카드에 시리즈 토글을 남기면
      // 볼 내용이 없는 줄이 36개 늘어난다.
      const series=M.seriesFor(c), others=series?series.studies.filter(s=>s.relation!=='current').length:0;
      const group=M.seriesGroupFor(c.id);
      if(group&&group.patientId!==lastSeries)list.append(seriesHead(group));
      lastSeries=group?group.patientId:null;
      if(group)card.classList.add('md-in-series');
      // 코호트마다 예측 arm 수가 다르므로, 비교에 실제로 쓰인 모델 수를 카드의 보이는 줄에 남긴다.
      const arms=M.models.filter(k=>(e&&e.models&&e.models[k])||(c.models&&c.models[k]));
      const armNote=arms.length&&arms.length<M.models.length?` · AI 비교 ${arms.length}/${M.models.length}종`:'';
      const idBox=el('div',null,'md-case-id');idBox.append(el('h2',c.id));
      if(group)idBox.append(el('span','합성 · '+group.patientId,'md-case-series-tag'));
      card.append(idBox);
      // 1열 검사 ID · 2열 판독 근거와 규모 · 3열 흐름 상태 · 4열 동작. 같은 결의 정보가 같은 줄에 있다.
      const main=el('div',null,'md-case-main');
      main.append(el('strong',c.synthetic?'DEMO ONLY · 합성 워크플로 시연 · 실제 CT/환자 없음':M.reason(e)+armNote,'md-core-reason'),triageStrip(c,e));
      card.append(main,flowState(c,state));
      const d=details(c,e);card.append(d);const viewer=el('div',null,'md-inline-viewer');viewer.hidden=true;let view;
      // The study series belongs to the reading view, so it opens with the CT and never
      // adds a third always-visible band to the collapsed card.
      const seriesBox=others?seriesBlock(c):null;if(seriesBox)seriesBox.hidden=true;
      const open=action('CT 확대',()=>{if(viewer.hidden){d.open=false;viewer.hidden=false;if(seriesBox)seriesBox.hidden=false;view=MViewer();open.textContent='CT 접기';}else{view.close();viewer.hidden=true;if(seriesBox)seriesBox.hidden=true;open.textContent='CT 확대';}});
      function MViewer(){const v=g.MDViewer.mount(viewer,c);views.push(v);return v;}
      const review=action(state.reviews[c.id]?'다시 검토':'확인함',()=>{try{records.review(c.id,!state.reviews[c.id]);refresh();}catch(_){say('검토 저장 실패 · 상태 불변');}});
      review.setAttribute('aria-pressed',String(!!state.reviews[c.id]));
      const send=action('주치의에게 전송하기',()=>sendModal(c,e,send,()=>viewer.hidden?null:view));
      const actions=el('div',null,'md-case-actions');actions.append(open);const decisions=el('div',null,'md-decision-actions');decisions.append(el('span','검토 후'),review,send);card.append(actions);
      if(!M.eligible(c))d.append(el('p','실제 보내기 차단 · 승인된 환자–임상과 담당자 연결 없음 (병리학과 제외). 전송 창에서 참고 모델/메모 초안 확인 가능.'));
      for(const sent of Object.values(state.sends).filter(r=>r.case.id===c.id)){
        const link=el('a','보낸 기록 상세 · '+sent.time,'md-sent-record-link');link.href=M.recordLink(scope,sent.id);card.append(link);
      }
      card.append(viewer,seriesBox,decisions);list.append(card);
    }
    if(!items.length)list.append(el('p','조건에 맞는 사례 없음 · 전체 필터에서 다시 검토할 수 있습니다.'));
  }
  function sendModal(c,e,trigger,getViewer){const dialog=doc.getElementById('mdSendDialog');dialog.replaceChildren();
    const savedDraft=state.drafts[c.id];
    let draft=M.normalizeDraft(c,savedDraft);
    if(savedDraft === undefined)draft.viewpointChoice='auto';
    const baseline=JSON.stringify(draft);let busy=false, researchEnvelope=null, focusAfterClose=null, optInNodes=null;
    const error=el('p');error.setAttribute('role','alert');
    const persist=()=>{syncReferences();try{records.draft(c.id,draft);error.textContent='초안 로컬 저장됨 · 실제 전송 아님';}catch(_){error.textContent='초안 저장 실패 · 이 창의 입력을 유지합니다.';}};
    const close=()=>{if(busy)return;if(JSON.stringify(draft)!==baseline||draft.notes||draft.selected.length){confirm.hidden=false;confirm.focus();return;}dialog.close();};
    const x=action('×',close);x.title='전송 취소 및 닫기';x.setAttribute('aria-label','전송 취소 및 닫기');x.className='md-send-close';
    const legacyDemo=M.eligible(c);let allowed=legacyDemo;const title=el('h2','주치의에게 전송하기'+(allowed?' · DEMO ONLY':' · 보내기 미연결'));title.id='mdSendTitle';dialog.setAttribute('aria-labelledby',title.id);dialog.append(x,title,el('p',c.id,'md-send-id'),el('p',allowed?`수신: ${c.mapping.recipientId} · ${c.mapping.department} · 합성 환자 ${c.mapping.patientId}`:'수신 담당자 미연결 · 승인된 환자–임상과 주치의/담당 의료진 매핑 없음 · 병리학과 제외'),el('p','AI 분석 요약: 생성형 AI 소견 없음'),el('p',M.reason(e),'md-send-reason'));
    if(!legacyDemo){
      const optLabel=el('label','LOCAL DEMO로 연구 CT를 로컬 전달하기 (실제 환자/주치의 연결·병원 전송 아님)','md-demo-opt-in');
      const opt=el('input');opt.type='checkbox';opt.checked=false;opt.disabled=!sourceContext;
      opt.onchange=()=>{
        researchEnvelope=null;
        try{if(opt.checked)researchEnvelope=M.localDemoEnvelope(c,sourceContext,true);}
        catch(_){opt.checked=false;error.textContent='연구 CT 원본 연결을 확인할 수 없습니다. 로컬 전달 불가.';}
        allowed=legacyDemo||!!researchEnvelope;
        title.textContent='주치의에게 전송하기'+(researchEnvelope?' · LOCAL DEMO (연구 CT)':' · 보내기 미연결');
        demoRole.textContent=researchEnvelope?'LOCAL DEMO MD → LOCAL DEMO 임상 담당자 · 연구 데이터셋 CT · 환자 연결 없음':'실제 임상 전송 차단 · 로컬 DEMO를 선택하면 이 브라우저에만 저장됩니다.';
        syncReferences();
      };
      optLabel.prepend(opt);const demoRole=el('p','실제 임상 전송 차단 · 로컬 DEMO를 선택하면 이 브라우저에만 저장됩니다.','md-demo-roles');
      optInNodes=[optLabel,demoRole];dialog.append(...optInNodes);
    }
    const precheck=el('fieldset',null,'md-precheck');precheck.append(el('legend','사전 의견  ·  선택 입력 · 미작성 시 미기록'));
    precheck.append(el('p','이 창은 재검토 목록의 모델 불일치 신호를 이미 표시합니다. 따라서 이 항목은 AI를 보기 전의 독립적 판단이 아니라, 전송 시점에 남기는 MD의 참고 기록입니다.','md-precheck-caveat'));
    const precheckRadios={};for(const key of M.precheckOptions){const l=el('label',M.precheckLabels[key]),r=el('input');r.type='radio';r.name='md-precheck';r.value=key;r.checked=draft.precheck===key;r.onchange=()=>{if(!r.checked)return;draft.precheck=key;precheckClear.disabled=false;persist();};precheckRadios[key]=r;l.prepend(r);precheck.append(l);}
    const precheckClear=action('미작성으로 되돌리기',()=>{delete draft.precheck;for(const key of M.precheckOptions){precheckRadios[key].checked=false;}precheckClear.disabled=true;persist();});
    precheckClear.disabled=draft.precheck===undefined;precheckClear.className='md-precheck-clear';precheck.append(precheckClear);dialog.append(precheck);
    // Model pairs repeat the same candidate; collapse to one row per candidate and
    // let the row drive the CT marker layer instead of leaving the list as text only.
    let candidateBox=null;const candidates=M.reviewCandidates(e);let activeCandidate=null;
    if(candidates.length){
      const box=el('fieldset',null,'md-candidates');
      box.append(el('legend',`재검토 후보 ${candidates.length}건 · 모델 쌍 ${e.reasons.length}행을 후보 단위로 합침 · 행을 누르면 CT에 표시`));
      const rows={};const rowWrap=el('div',null,'md-candidate-rows');
      for(const k of candidates){
        const b=action(M.candidateLabel(k),()=>{activeCandidate=activeCandidate===k.candidateId?null:k.candidateId;paintCandidates();});
        b.className='md-candidate-row';b.dataset.candidateId=k.candidateId;b.setAttribute('aria-pressed','false');
        const who=[(k.model&&M.labels[k.model])||'알 수 없는 모델',k.pairs.map(p=>M.labels[p]||p).join(', ')||'상대 모델 기록 없음'].join(' ↔ ');
        b.title=who+' · voxel '+(k.voxel.length?k.voxel.join(', '):'기록 없음');
        rows[k.candidateId]=b;rowWrap.append(b);
      }
      const candidateNote=el('p',null,'md-candidate-note');candidateNote.setAttribute('role','status');
      // The dialog covers the CT behind it, so the marker has to render in here too.
      const preview=el('figure',null,'md-candidate-preview');
      const previewImg=el('img');previewImg.alt='';previewImg.hidden=true;
      const previewMark=el('span',null,'md-candidate-mark');previewMark.hidden=true;
      // The marker is placed in image space, so its box has to hug the image alone,
      // not the figure that also carries the caption.
      const previewFrame=el('div',null,'md-candidate-frame');previewFrame.append(previewImg,previewMark);
      const previewCap=el('figcaption','후보를 고르면 이 절편의 CT에 후보 위치를 표시합니다. 표시 전용이며 HU·진단 정보가 아닙니다.','md-candidate-caption');
      preview.append(previewFrame,previewCap);
      box.append(rowWrap,candidateNote,preview);candidateBox=box;dialog.append(box);
      async function paintPreview(k){
        if(!k||k.slice===null||!c.slices?.[k.slice]?.ct){previewImg.hidden=true;previewMark.hidden=true;previewCap.textContent='절편 정보가 없어 미리보기를 표시하지 않습니다. 표시 전용이며 진단 정보가 아닙니다.';return;}
        previewImg.src='/'+c.slices[k.slice].ct.replace(/^\/+/, '');
        previewImg.alt=`${c.id} 절편 ${k.slice+1} · 후보 ${k.candidateId} 위치 표시`;
        previewImg.hidden=false;
        // Candidate voxel coordinates are 512x512 image space; the crosshair is a
        // display-only marker, never a measurement.
        const [vx,vy]=k.voxel;
        if(Number.isFinite(vx)&&Number.isFinite(vy)){previewMark.style.left=(vx/512*100)+'%';previewMark.style.top=(vy/512*100)+'%';previewMark.hidden=false;}
        else previewMark.hidden=true;
        previewCap.textContent=`절편 ${k.slice+1} · ${k.candidateId} · voxel ${k.voxel.length?k.voxel.join(', '):'기록 없음'} · 표시 전용`;
      }
      function paintCandidates(){
        for(const [id,b] of Object.entries(rows))b.setAttribute('aria-pressed',String(activeCandidate===id));
        try{getViewer()?.setCandidates(candidates,activeCandidate);}catch(_){}
        const k=candidates.find(x=>x.candidateId===activeCandidate)||null;
        candidateNote.textContent=activeCandidate?`${activeCandidate} 표시 중 · 해당 절편으로 이동`:'후보 미선택 · CT에 표시 없음';
        paintPreview(k);
      }
      paintCandidates();
    }
    const viewpointGroup=el('fieldset',null,'md-viewpoint-options');viewpointGroup.append(el('legend','전달 화면 위치'));
    const basicLabel=el('label','기본 보기 (화면 위치 첨부 안 함)'),basic=el('input');basic.type='radio';basic.name='md-viewpoint';basic.value='basic';
    const attachLabel=el('label','현재 표시된 절편·확대·이동·표시 대비·오버레이 첨부 (기본값)'),attach=el('input');attach.type='radio';attach.name='md-viewpoint';attach.value='attached';
    basicLabel.prepend(basic);attachLabel.prepend(attach);
    const viewpointStatus=el('p',null,'md-viewpoint-status');viewpointStatus.setAttribute('role','status');
    const binding={manifestSha256:scope,sourceCaseId:c.id};
    // Freeze the first committed frame for an automatic draft; subscriptions only fill
    // an initially unloaded view, never replace a saved or intentional choice.
    let awaitingFrame=draft.viewpointChoice==='auto' && draft.viewpoint==null && !legacyDemo;
    function captureDefault(){
      if(!awaitingFrame)return false;
      const frame=getViewer()?.capture();if(!frame)return false;
      draft.viewpoint=M.attachViewpoint(frame,c,binding);awaitingFrame=false;return true;
    }
    captureDefault();
    function validViewpoint(){try{M.validateViewpoint(draft.viewpoint,c,binding);return true;}catch(_){return false;}}
    function describeViewpoint(){
      const viewer=getViewer(),current=viewer?.capture(),loading=viewer?.state();
      attach.disabled=!current||legacyDemo;
      basic.checked=draft.viewpoint==null;attach.checked=!basic.checked;
      const live=current?`현재 표시 ${current.slice+1} / ${c.slices.length}`:'현재 표시 없음 · CT를 먼저 열어주세요';
      const pending=loading?.pendingSlice!=null?` · 요청 ${loading.pendingSlice+1} 불러오는 중 (첨부하지 않음)`:'';
      const saved=draft.viewpoint;
      viewpointStatus.textContent=live+pending+' · '+(saved?(validViewpoint()?`첨부 절편 ${saved.slice+1}, 확대 ${saved.zoom}, 이동 (${saved.panX}, ${saved.panY}), PNG/WebP 표시 대비 ${saved.contrast} (HU 아님), 오버레이 ${saved.overlayMode??'seg'} · ${saved.overlayVisible===false?'숨김':'표시'}`:'저장된 화면 위치 오류 · 기본 보기 또는 현재 표시 위치를 다시 선택하세요'):awaitingFrame?'화면 위치 첨부 없음 · 완성된 표시 영상이 생기면 자동 첨부':'기본 보기 · 화면 위치 첨부 없음');
    }
    basic.onclick=()=>{awaitingFrame=false;draft.viewpointChoice='basic';delete draft.viewpoint;describeViewpoint();persist();};
    attach.onchange=()=>{
      try{draft.viewpoint=M.attachViewpoint(getViewer()?.capture(),c,binding);delete draft.viewpointChoice;awaitingFrame=false;}
      catch(_){error.textContent='완성된 표시 영상이 없어 첨부할 수 없습니다.';}
      describeViewpoint();persist();
    };
    viewpointGroup.append(basicLabel,attachLabel,viewpointStatus);dialog.append(viewpointGroup);
    describeViewpoint();const unsubscribe=getViewer()?.subscribe(()=>{
      if(captureDefault())persist();
      describeViewpoint();
    });
    const group=el('fieldset');group.append(el('legend','참고 모델 (다중 선택) 또는 모델 참고 없음'));
    const checks={};for(const key of M.models){const label=el('label',M.labels[key]), check=el('input');check.type='checkbox';check.checked=draft.selected.includes(key);check.disabled=!M.availableModel(c,key);checks[key]=check;
      check.onchange=()=>{draft.selected=M.models.filter(k=>checks[k].checked);draft.none=!draft.selected.length;persist();};label.prepend(check);group.append(label);}
    const noLabel=el('label','모델 참고 없음'),none=el('input');none.type='checkbox';none.checked=draft.none;none.onchange=()=>{draft.none=none.checked;if(draft.none)draft.selected=[];persist();};noLabel.prepend(none);group.append(noLabel);dialog.append(group);
    const followup=el('fieldset',null,'md-followup');followup.append(el('legend','후속조치 의견  ·  MD 작성 · AI 자동 선택 아님'));
    const followupHint=el('p','메모에 원하는 후속조치를 직접 적어주세요.','md-followup-hint');followupHint.hidden=draft.followup!=='other';
    const followupRadios={};for(const key of M.followupOptions){const l=el('label',M.followupLabels[key]),r=el('input');r.type='radio';r.name='md-followup';r.value=key;r.checked=draft.followup===key;r.onchange=()=>{if(!r.checked)return;draft.followup=key;if(key!=='immediate_us_biopsy'){delete draft.biopsy;biopsySelect.value='';delete draft.biopsyProtocol;protocolSelect.value='';}followupHint.hidden=key!=='other';syncFollowupVisibility();persist();};followupRadios[key]=r;l.prepend(r);followup.append(l);}
    followup.append(followupHint);
    // Biopsy needs a target, not a free-text hint: pick the candidate from a list.
    const biopsyWrap=el('div',null,'md-biopsy');
    // Which guidance route performs the biopsy decides who does it, where, and what
    // preparation is needed, so the MD picks it explicitly. Nothing defaults to US.
    const protocolGuideBox=el('div',null,'md-biopsy-guide');protocolGuideBox.hidden=true;
    function renderProtocolGuide(key){protocolGuideBox.replaceChildren();const guide=M.protocolGuide(key);if(!guide)return;
      protocolGuideBox.append(el('p',guide.title,'md-biopsy-guide-title'),
        el('p','적합 예시 · '+guide.fit,'md-biopsy-guide-line'),
        el('p','사전 확인 · '+guide.steps.join(' · '),'md-biopsy-guide-line'),
        el('p','기관 확인 필요 · '+guide.confirm,'md-biopsy-guide-confirm'),
        el('p',guide.authority,'md-biopsy-guide-note'));}
    const protocolLabel=el('label','조직검사 프로토콜 (AI 자동 선택 아님)');
    const protocolSelect=el('select');
    const protocolNone=el('option','프로토콜 선택 안 함');protocolNone.value='';protocolSelect.append(protocolNone);
    for(const key of M.biopsyProtocolOptions){const o=el('option',M.biopsyProtocolLabels[key]);o.value=key;protocolSelect.append(o);}
    protocolSelect.value=draft.biopsyProtocol||'';
    if(!draft.biopsyProtocol)delete draft.biopsyProtocol;
    if(draft.followup==='immediate_us_biopsy'&&draft.biopsyProtocol)renderProtocolGuide(draft.biopsyProtocol);
    protocolSelect.onchange=()=>{
      if(protocolSelect.value)draft.biopsyProtocol=protocolSelect.value;else delete draft.biopsyProtocol;
      renderProtocolGuide(protocolSelect.value);syncFollowupVisibility();persist();};
    protocolLabel.append(protocolSelect);
    const protocolHint=el('p','프로토콜을 고르지 않으면 전송할 수 없습니다. US가 기본값이 아닙니다.','md-biopsy-note');
    const biopsyLabel=el('label','조직검사할 후보 (AI 자동 선택 아님)');
    const biopsySelect=el('select');
    const biopsyNone=el('option','후보 선택 안 함');biopsyNone.value='';biopsySelect.append(biopsyNone);
    for(const k of candidates){const o=el('option',M.candidateLabel(k));o.value=k.candidateId;biopsySelect.append(o);}
    biopsySelect.value=draft.biopsy||'';
    if(!draft.biopsy)delete draft.biopsy;
    biopsySelect.onchange=()=>{if(biopsySelect.value)draft.biopsy=biopsySelect.value;else delete draft.biopsy;persist();};
    biopsyLabel.append(biopsySelect);
    const biopsyNote=el('p',candidates.length?'AI가 후보를 고르지 않습니다. 아래 목록에서 직접 선택하세요. 선택은 표시 전용이며 판정·측정이 아닙니다.':'이 사례에는 표시할 재검토 후보가 없어 조직검사 후보를 고를 수 없습니다.','md-biopsy-note');
    biopsyWrap.append(protocolLabel,protocolHint,protocolGuideBox,biopsyLabel,biopsyNote);followup.append(biopsyWrap);
    dialog.append(followup);
    const notesLabel=el('label','MD 추가 소견·임상 메모 (로컬 초안 · 실제 전송 불가)'),notes=el('textarea');notes.value=draft.notes;notes.oninput=()=>{draft.notes=notes.value;persist();};notesLabel.append(notes);
    const notesWrap=el('div',null,'md-notes-wrap');notesWrap.append(notesLabel);dialog.append(notesWrap,error);
    // The clinical note is only useful as free text next to "기타". Already-written
    // notes stay visible so nothing the MD typed is hidden away.
    function syncFollowupVisibility(){
      const biopsy=draft.followup==='immediate_us_biopsy';
      biopsyWrap.hidden=!biopsy;
      biopsyNote.hidden=!biopsy;
      protocolGuideBox.hidden=!(biopsy&&draft.biopsyProtocol);
      notesWrap.hidden=!(draft.followup==='other'||draft.notes.trim());
    }
    syncFollowupVisibility();
    const visit=M.visitStatus(c);
    const visitBox=el('fieldset',null,'md-visit');
    visitBox.append(el('legend','환자 내원 정보  ·  시연용 가정값 · 실제 환자 데이터 아님'));
    visitBox.append(el('p',M.visitLabel(visit),'md-visit-status'));
    if(visit==='scheduled_not_visited'){
      const l=el('label','주치의에게 외래 요청 요청 (발송 아님 · 기록만 남김)'),cb=el('input');
      cb.type='checkbox';cb.checked=draft.visitRequest===true;
      cb.onchange=()=>{if(cb.checked)draft.visitRequest=true;else delete draft.visitRequest;persist();};
      l.prepend(cb);visitBox.append(l);
    } else {
      visitBox.append(el('p','미내원 사례가 아니라 외래 요청 선택지는 없습니다.','md-visit-note'));
    }
    dialog.append(visitBox);
    const send=action('✈',()=>{if(busy||!allowed||!validViewpoint()||!M.selection(c,draft.selected,draft.none))return;busy=true;send.disabled=true;try{
      const record=records.send(c,draft,e,researchEnvelope?'LOCAL_DEMO':'DEMO',researchEnvelope);
      dialog.close();refresh();say('LOCAL DEMO 저장 확인 완료 · 실제 병원 전송 아님');
      const result=doc.getElementById('mdSendResult');result.replaceChildren();
      const link=el('a','보낸 사례 상세 보기','md-sent-record-link');link.href=M.recordLink(scope,record.id);
      result.append(el('p',`${record.case.id} · 로컬 전달 저장됨`),link);focusAfterClose=link;link.focus();
    }catch(_){error.textContent='전송 저장 실패 또는 선택 오류 · 입력 유지 · 다시 시도하세요.';}finally{busy=false;syncReferences();}});send.disabled=!allowed;send.className='md-send-submit';send.title=allowed?'로컬 DEMO 수신함에 저장':'승인된 수신 담당자 미연결 · 보내기 불가';send.setAttribute('aria-label',allowed?'DEMO 보내기':'보내기 불가 · 수신 담당자 미연결');const cancel=action('취소',close);dialog.append(send,cancel);
    function syncReferences(){
      Object.assign(draft,M.normalizeReferences(c,draft.selected,draft.none));
      for(const key of M.models)checks[key].checked=draft.selected.includes(key);
      none.checked=draft.none;
      send.disabled=busy||!allowed||!validViewpoint()||!M.selection(c,draft.selected,draft.none);
      send.title=allowed?'이 브라우저의 LOCAL DEMO 수신함에 저장':'승인된 수신 담당자 미연결 · 보내기 불가';
      send.setAttribute('aria-label',allowed?(researchEnvelope?'LOCAL DEMO 보내기':'DEMO 보내기'):'보내기 불가 · 수신 담당자 미연결');
    }
    syncReferences();
    if(JSON.stringify(savedDraft)!==JSON.stringify(draft) && (savedDraft !== undefined || draft.viewpoint))persist();
    // 3차 기획 멘토링 §11 "중요도가 다른 기능을 같은 수준으로 강조하지 않는다"와
    // 32:46-38:06 "유저 플로우 -> 정보 중요도 -> 배치/강조"를 따라 모달을 세 레이어로
    // 나눈다. 같은 레이어 안의 항목은 서로 같은 강조 수준을 쓰고, 레이어 순서가
    // 판단 흐름(입력 -> 함께 남는 정보 -> 전송)을 따라간다. 노드는 재부착된다.
    const decision=el('section',null,'md-layer md-layer-decision');
    decision.append(el('h3','전달 판단  ·  MD가 직접 입력'),el('p','필수: 참고 모델과 전송 가능 여부 · 선택: 사전 의견·추가 메모','md-layer-hint'));
    if(optInNodes)decision.append(...optInNodes);
    if(candidateBox)decision.append(candidateBox);
    decision.append(group,precheck,followup,notesWrap);
    const context=el('section',null,'md-layer md-layer-context');
    context.append(el('h3','전달에 함께 남는 정보  ·  판단 입력보다 낮은 수준'));
    context.append(viewpointGroup,visitBox);
    const seriesInfo=M.seriesFor(c);
    const seriesOthers=seriesInfo?seriesInfo.studies.filter(s=>s.relation!=='current').length:0;
    if(seriesOthers)context.append(el('p',`이 환자 검사 시리즈: ${M.seriesSummary(c)} · ${seriesInfo.basis} · 이 창에서 표시하고 전송 기록에도 같은 검사 시리즈 스냅샷으로 남깁니다.`,'md-context-series'));
    else if(seriesInfo&&seriesInfo.duplicates&&seriesInfo.duplicates.length)context.append(el('p',`같은 검사가 이 창에 다시 표시되지 않습니다. 복제 표시: ${seriesInfo.duplicates.map(d=>d.alias+' · '+d.reason).join(', ')} · 이 창에서 표시하고 전송 기록에도 같은 검사 시리즈 스냅샷으로 남깁니다.`,'md-context-series'));
    const actionLayer=el('section',null,'md-layer md-layer-action');
    actionLayer.append(error,send,cancel);
    dialog.append(decision,context,actionLayer);
    const confirm=el('section',null,'md-discard-confirm');confirm.hidden=true;confirm.tabIndex=-1;confirm.setAttribute('role','alert');confirm.append(el('p','작성한 초안을 폐기할까요?'),action('계속 작성',()=>{confirm.hidden=true;notes.focus();}),action('초안 보관하고 닫기',()=>{syncReferences();try{records.draft(c.id,draft);dialog.close();}catch(_){error.textContent='초안 저장 실패 · 닫지 않았습니다.';}}),action('폐기하고 닫기',()=>{try{records.discard(c.id);dialog.close();}catch(_){error.textContent='초안 폐기 실패';}}));actionLayer.append(confirm);
    dialog.oncancel=event=>{event.preventDefault();close();};dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}};
    dialog.onclose=()=>{try{getViewer()?.setCandidates([],null);}catch(_){}unsubscribe?.();try{state=readState();}catch(_){}if(focusAfterClose?.isConnected)focusAfterClose.focus();else if(trigger.isConnected)trigger.focus();else filter.focus();};dialog.showModal();notes.focus();
  }
  filter.onchange=search.oninput=render;
  window.addEventListener('storage',event=>{if(event.key===records?.key)refresh();});render();
})(globalThis);

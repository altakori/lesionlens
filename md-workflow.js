(async function(g){
  'use strict';
  const M=g.MD, doc=document, root=doc.getElementById('mdQueue');if(!root)return;
  const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=doc.getElementById('mdStatus'), list=doc.getElementById('mdList'), search=doc.getElementById('mdSearch');
  let activeFilter='all';
  const openRows=new Set(), selectedStudies=new Map();
  const tabs=doc.getElementById('mdFilterTabs');
  let cases=[], evidence={}, records, state, views=[], sourceContext=null;
  const say=t=>{status.textContent=t;};
  let scope='demo-only-v1';
  try{
    const response=await fetch('data/model_compare/manifest.json',{cache:'no-store'});if(!response.ok)throw Error();
    const text=await response.text(), raw=JSON.parse(text), actual=normalizeManifest(raw);if(!actual.length)throw Error();
    scope=await M.digest(text);cases=actual.filter(c=>M.seriesGroupFor(c.id));sourceContext={manifestSha256:scope,manifestVersion:raw.version,cases:actual};
    try{const r=await fetch('data/model_compare/evidence.json',{cache:'no-store'});if(r.ok){const e=await r.json();if(e.version==='md-evidence-v1'&&e.manifestSha256===scope&&e.rules.clinicalValidation===false){evidence=e.cases;sourceContext.evidenceContext={version:e.version,manifestSha256:e.manifestSha256,rules:e.rules};}}}catch(_){}
    say('모델 후보 비교 · GT는 이유/정렬에서 제외됩니다.');
  }catch(_){say('합성 시리즈 자료를 불러올 수 없습니다. 원본 자료 연결을 확인해주세요.');}
  function readState(){const s=records.read();for(const c of cases){if(!Object.hasOwn(s.reviews,c.id)&&localStorage.getItem(reviewKey(MANIFEST_VERSION,c.id))==='true')s.reviews[c.id]=true;}return s;}
  try{records=M.store(localStorage,scope);state=readState();}catch(_){say('저장소 오류 · 검토/전송 변경 불가');state={reviews:{},sends:{},drafts:{}};}
  function action(label,fn){const b=el('button',label);b.type='button';b.onclick=fn;return b;}
  function refresh(){try{state=readState();render();}catch(_){say('저장소 오류 · 성공으로 처리하지 않았습니다.');}}
  function details(c,e){
    const box=el('section',null,'md-ai-preview');box.append(el('h3','AI 소견·Radiomics'));
    const content=el('div',null,'md-ai-content');content.id='ai-'+c.id;
    const reasons=el('div',null,'md-reasons');
    if(e?.reasons.length)for(const r of e.reasons)reasons.append(el('p',`${M.labels[r.model]} ${r.candidateId} ↔ ${M.labels[r.otherModel]} · ${r.kind} · 절편 ${r.slice+1}${r.smallAdditional?' · 작은 추가 후보':''}`));
    else reasons.append(el('p',M.reason(e)));
    content.append(reasons);
    const table=el('table',null,'md-quant-table');table.append(el('caption','모델별 3D 연결 성분 · 확진 병변 수 아님'));
    const head=el('tr');for(const t of ['측정 모델','후보 수','최대 후보 mL','전체 후보 mL'])head.append(el('th',t));table.append(head);
    for(const k of M.models){const v=e?.models[k]||c.models[k], row=el('tr');
      const values=v?[M.labels[k],v.componentCount,v.maxVolumeMl??Math.max(0,...v.componentVolumesMl),v.totalVolumeMl??v.volumeMl]:[M.labels[k],'자료 없음','—','—'];
      values.forEach(x=>row.append(el('td',typeof x==='number'?String(Number(x.toFixed(4))):x)));table.append(row);}
    content.append(table,el('p',M.seriesSummary(c),'md-source-summary'),el('p','원본 CT ID · '+c.id,'md-source-id'),el('p','모델 비교 근거입니다. 생성형 소견·진단·응급도 판단이 아닙니다. 별도 Radiomics 데이터셋은 자동 매칭하지 않습니다.','md-evidence-note'));
    const more=action('자세히 보기 ⌄',()=>{const expanded=more.getAttribute('aria-expanded')!=='true';more.setAttribute('aria-expanded',String(expanded));box.classList.toggle('is-expanded',expanded);more.textContent=expanded?'접기 ⌃':'자세히 보기 ⌄';});
    more.className='md-ai-more';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls',content.id);box.append(content,more);return box;
  }
  function fmtMl(v){const n=Number(v);return Number(n.toFixed(n<1?3:2));}
  function triageStrip(c,e){
    const strip=el('div',null,'md-triage');
    const modelKeys=e&&e.models?Object.keys(e.models):[];
    if(!e||!modelKeys.length){strip.append(el('span','AI 비교 근거 미산출','md-stat md-stat-warn'));return strip;}
    const n=M.reviewCandidates(e).length;
    const total=modelKeys.reduce((s,k)=>s+((e.models[k]&&e.models[k].candidates)||[]).length,0);
    const label=!n?(total?'모델 간 차이 없음':'모델 후보 없음'):('재검토 후보 '+n+'개');
    strip.append(el('span',label,'md-stat'+(n?' md-stat-lead':'')));
    const avail=M.models.map(k=>(e.models&&e.models[k])||(c.models&&c.models[k])).filter(Boolean);
    const sizes=avail.map(m=>Number(m.maxVolumeMl??Math.max(0,...(m.componentVolumesMl||[0])))).filter(Number.isFinite);
    if(sizes.length)strip.append(el('span','가장 큰 후보 '+fmtMl(Math.max(...sizes))+' mL','md-stat'));
    return strip;
  }
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
  function renderTabs(){
    tabs.replaceChildren();
    for(const key of ['pending','reviewed','sent']){
      const n=M.patientQueue(cases,evidence,state,key,search.value).length;
      const b=action(M.queueFilterLabels[key]+' '+n,()=>{activeFilter=activeFilter===key?'all':key;render();tabs.querySelector(`[data-filter="${key}"]`)?.focus();});
      b.className='md-filter-tab';b.dataset.filter=key;b.setAttribute('aria-pressed',String(activeFilter===key));b.title='다시 누르면 전체 목록';tabs.append(b);
    }
  }
  function render(){
    views.forEach(v=>v.close());views=[];list.replaceChildren();renderTabs();
    const rows=M.patientQueue(cases,evidence,state,activeFilter,search.value);
    doc.getElementById('mdListCount').textContent=(activeFilter==='all'?'전체':M.queueFilterLabels[activeFilter])+' '+rows.length+'건';
    rows.forEach(row=>{
      const current=row.current, card=el('article',null,'md-case-card md-patient-row');card.dataset.caseId=current.id;card.dataset.patientKey=row.key;
      const body=el('div',null,'md-case-body');body.id='body-'+current.id;body.hidden=true;let view=null;
      if(row.group)card.append(el('div',`합성 검사 이력 · CT ${row.studies.length}건 · 실제 환자의 경과 아님`,'md-series-head'));
      const head=action('',()=>toggle(!openRows.has(row.key)));head.className='md-row-toggle';head.setAttribute('aria-expanded','false');head.setAttribute('aria-controls',body.id);
      const idBox=el('span',null,'md-case-id');idBox.append(el('strong',String(row.number),'md-case-number'),el('span',current.synthetic?'워크플로 시연':row.group?'검사 이력 '+row.studies.length+'건':'CT 1건','md-case-caption'));
      const main=el('span',null,'md-case-main'),e=evidence[current.id];
      const arms=M.models.filter(k=>e?.models?.[k]||current.models?.[k]);
      main.append(el('strong',current.synthetic?'의견 전달 시연 · CT 없음':M.reason(e)+(arms.length&&arms.length<M.models.length?' · AI 비교 '+arms.length+'/3종':''),'md-core-reason'),triageStrip(current,e));
      const caret=el('span','⌄','md-row-caret');caret.setAttribute('aria-hidden','true');head.append(idBox,main,flowState(current,state),caret);head.setAttribute('aria-label',`${row.number}번 검토 · ${current.synthetic?'워크플로 시연':M.reason(e)}`);
      const studyTabs=el('div',null,'md-study-tabs'),reading=el('div',null,'md-reading');
      if(row.studies.length>1){
        studyTabs.setAttribute('role','group');studyTabs.setAttribute('aria-label','검사 이력 · 시연 시간순');
        for(const item of row.studies){const prior=item.id===row.group.prior;
          const b=action(prior?'이전 CT · 약 '+row.group.intervalMonths+'개월 전 (시연)':'현재 CT (시연)',()=>showStudy(item));
          b.dataset.studyId=item.id;b.setAttribute('aria-pressed',String(item.id===current.id));studyTabs.append(b);}
        body.append(el('p','서로 다른 연구 CT를 연결한 시연 이력입니다. 실제 촬영일·환자 경과가 아닙니다.','md-history-note'),studyTabs);
      }
      body.append(reading);card.append(head,body);list.append(card);
      function showStudy(item){
        if(view){view.close();views=views.filter(v=>v!==view);view=null;}selectedStudies.set(row.key,item.id);reading.replaceChildren();
        for(const b of studyTabs.children)b.setAttribute('aria-pressed',String(b.dataset.studyId===item.id));
        const d=details(item,evidence[item.id]),host=el('div',null,'md-inline-viewer');host.dataset.studyId=item.id;
        reading.append(d,host);view=g.MDViewer.mount(host,item);views.push(view);
        if(Number.isInteger(item.defaultSlice))view.setSlice(item.defaultSlice);
        const review=action(state.reviews[item.id]?'다시 검토':'확인함',()=>{try{records.review(item.id,!state.reviews[item.id]);refresh();const next=list.querySelector(`[data-case-id="${current.id}"]`);(next?.querySelector('.md-row-toggle')||tabs.querySelector('button'))?.focus();}catch(_){say('검토 저장 실패 · 상태 불변');}});
        review.setAttribute('aria-pressed',String(!!state.reviews[item.id]));
        const send=action('주치의에게 전송하기',()=>sendModal(item,evidence[item.id],send,()=>view));send.className='md-primary';
        const actions=el('div',null,'md-decision-actions');actions.append(el('span','검토 후'),review,send);reading.append(actions);
      }
      function toggle(open){
        if(open){openRows.add(row.key);body.hidden=false;head.setAttribute('aria-expanded','true');caret.textContent='⌃';showStudy(row.studies.find(c=>c.id===selectedStudies.get(row.key))||current);
        }else{openRows.delete(row.key);if(view){view.close();views=views.filter(v=>v!==view);view=null;}body.hidden=true;reading.replaceChildren();head.setAttribute('aria-expanded','false');caret.textContent='⌄';}
      }
      if(openRows.has(row.key))toggle(true);
    });
    if(!rows.length)list.append(el('p','조건에 맞는 사례가 없습니다. 선택한 필터를 다시 누르면 전체 목록으로 돌아갑니다.','md-empty'));
  }
  function sendModal(c,e,trigger,getViewer){const dialog=doc.getElementById('mdSendDialog');dialog.replaceChildren();
    const savedDraft=state.drafts[c.id];
    let draft=M.normalizeDraft(c,savedDraft);
    delete draft.precheck;delete draft.biopsy;delete draft.viewpointChoice;delete draft.viewpoint;
    let baseline=JSON.stringify(draft);let busy=false, researchEnvelope=null, focusAfterClose=null;
    const error=el('p');error.setAttribute('role','alert');
    const persist=()=>{syncReferences();try{records.draft(c.id,draft);error.textContent='';}catch(_){error.textContent='초안 저장 실패 · 이 창의 입력을 유지합니다.';}};
    const close=()=>{if(busy)return;if(JSON.stringify(draft)!==baseline||draft.notes||draft.selected.length){confirm.hidden=false;confirm.focus();return;}dialog.close();};
    const x=action('×',close);x.title='전송 취소 및 닫기';x.setAttribute('aria-label','전송 취소 및 닫기');x.className='md-send-close';
    const legacyDemo=M.eligible(c);
    const localOnly=g.PUBLIC_DEMO.allowBrowserStorageDemo();
    if(!legacyDemo&&localOnly){try{researchEnvelope=M.localDemoEnvelope(c,sourceContext,true);}catch(_){}}
    const allowed=localOnly&&(legacyDemo||!!researchEnvelope);
    const title=el('h2','주치의에게 전송하기');title.id='mdSendTitle';dialog.setAttribute('aria-labelledby',title.id);
    dialog.append(x,title,el('p','DEMO · 이 브라우저의 수신함에 저장','md-send-id'),el('p',M.reason(e),'md-send-reason'));
    if(!allowed)error.textContent='로컬 자료 연결을 확인할 수 없어 저장할 수 없습니다.';
    const viewpointStatus=el('p',null,'md-viewpoint-status');viewpointStatus.setAttribute('role','status');
    const binding={manifestSha256:scope,sourceCaseId:c.id};
    function captureCurrent(){
      const frame=getViewer()?.capture();
      if(frame&&!legacyDemo){try{draft.viewpoint=M.attachViewpoint(frame,c,binding);}catch(_){delete draft.viewpoint;}}
      else delete draft.viewpoint;
      viewpointStatus.textContent=draft.viewpoint?`현재 화면 첨부 · 절편 ${draft.viewpoint.slice+1} / ${c.slices.length}`:'CT 화면 위치 없음';
    }
    function validViewpoint(){try{M.validateViewpoint(draft.viewpoint,c,binding);return true;}catch(_){return false;}}
    captureCurrent();baseline=JSON.stringify(draft);const unsubscribe=getViewer()?.subscribe(captureCurrent);
    const group=el('fieldset');group.append(el('legend','참고 모델 (다중 선택) 또는 모델 참고 없음'));
    const checks={};for(const key of M.models){const label=el('label',M.labels[key]), check=el('input');check.type='checkbox';check.checked=draft.selected.includes(key);check.disabled=!M.availableModel(c,key);checks[key]=check;
      check.onchange=()=>{draft.selected=M.models.filter(k=>checks[k].checked);draft.none=!draft.selected.length;persist();};label.prepend(check);group.append(label);}
    const noLabel=el('label','모델 참고 없음'),none=el('input');none.type='checkbox';none.checked=draft.none;none.onchange=()=>{draft.none=none.checked;if(draft.none)draft.selected=[];persist();};noLabel.prepend(none);group.append(noLabel);dialog.append(group);
    const followup=el('fieldset',null,'md-followup');followup.append(el('legend','후속조치 의견  ·  MD 작성 · AI 자동 선택 아님'));
    const followupHint=el('p','메모에 원하는 후속조치를 직접 적어주세요.','md-followup-hint');followupHint.hidden=draft.followup!=='other';
    const followupRadios={};for(const key of M.followupOptions){const l=el('label',M.followupLabels[key]),r=el('input');r.type='radio';r.name='md-followup';r.value=key;r.checked=draft.followup===key;r.onchange=()=>{if(!r.checked)return;draft.followup=key;if(key!=='immediate_us_biopsy'){delete draft.biopsy;delete draft.biopsyProtocol;protocolSelect.value='';}if(key!=='short_term_followup'){delete draft.followupModality;modalitySelect.value='';}followupHint.hidden=key!=='other';syncFollowupVisibility();persist();};followupRadios[key]=r;l.prepend(r);followup.append(l);}
    followup.append(followupHint);
    const modalityWrap=el('div',null,'md-followup-modality');
    const modalityLabel=el('label','추적검사 방법 (MD 선택)'),modalitySelect=el('select');
    modalitySelect.setAttribute('aria-label','추적검사 방법 (MD 선택)');
    const modalityNone=el('option','검사 방법 미지정');modalityNone.value='';modalitySelect.append(modalityNone);
    for(const key of M.followupModalityOptions){const option=el('option',M.followupModalityLabels[key]);option.value=key;modalitySelect.append(option);}
    modalitySelect.value=draft.followupModality||'';
    const modalitySelection=el('p',null,'md-followup-modality-selection');
    function syncModalitySelection(){modalitySelection.hidden=!draft.followupModality;modalitySelection.textContent=draft.followupModality?'선택 · '+M.followupModalityLabel(draft.followupModality):'';}
    syncModalitySelection();
    modalitySelect.onchange=()=>{if(modalitySelect.value)draft.followupModality=modalitySelect.value;else delete draft.followupModality;syncModalitySelection();persist();};
    modalityLabel.append(modalitySelect);
    modalityWrap.append(modalityLabel,modalitySelection,el('p','담당 MD가 검사 방법을 지정합니다. 선택하지 않으면 미지정으로 전달됩니다.','md-followup-modality-note'));followup.append(modalityWrap);
    const biopsyWrap=el('div',null,'md-biopsy');
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
    biopsyWrap.append(protocolLabel,protocolHint,protocolGuideBox);followup.append(biopsyWrap);
    dialog.append(followup);
    const notesLabel=el('label','추가 소견'),notes=el('textarea');notes.value=draft.notes;notes.oninput=()=>{draft.notes=notes.value;persist();};notesLabel.append(notes);
    const notesWrap=el('div',null,'md-notes-wrap');notesWrap.append(notesLabel);dialog.append(notesWrap,error);
    function syncFollowupVisibility(){
      const biopsy=draft.followup==='immediate_us_biopsy';
      modalityWrap.hidden=draft.followup!=='short_term_followup';
      syncModalitySelection();
      biopsyWrap.hidden=!biopsy;
      protocolGuideBox.hidden=!(biopsy&&draft.biopsyProtocol);
      notesWrap.hidden=!(draft.followup==='other'||draft.notes.trim());
    }
    syncFollowupVisibility();
    const visit=M.visitStatus(c);
    const visitBox=el('fieldset',null,'md-visit');
    visitBox.append(el('legend','환자 내원 정보'));
    visitBox.append(el('p','시연용 가정값 · 실제 환자 데이터 아님','md-visit-note'));
    visitBox.append(el('p',M.visitLabel(visit),'md-visit-status'));
    const visitRequestLabel=el('label','주치의에게 외래 확인 요청'),visitRequest=el('input');
    visitRequest.type='checkbox';visitRequest.checked=draft.visitRequest===true;visitRequest.disabled=!allowed;
    visitRequest.id='mdVisitRequest';visitRequestLabel.className='md-visit-request';
    visitRequest.onchange=()=>{if(visitRequest.checked)draft.visitRequest=true;else delete draft.visitRequest;persist();};
    visitRequestLabel.prepend(visitRequest);visitBox.append(visitRequestLabel);
    const visitHint=el('p','시연용 요청 기록입니다. 실제 예약·연락은 하지 않습니다.','md-visit-note');
    visitHint.id='mdVisitRequestHint';visitRequest.setAttribute('aria-describedby',visitHint.id);visitBox.append(visitHint);
    dialog.append(visitBox);
    const send=action('✈',()=>{captureCurrent();if(busy||!allowed||!validViewpoint()||!M.selection(c,draft.selected,draft.none))return;busy=true;send.disabled=true;try{
      const record=records.send(c,draft,e,researchEnvelope?'LOCAL_DEMO':'DEMO',researchEnvelope);
      dialog.close();refresh();say('LOCAL DEMO 저장 확인 완료 · 실제 병원 전송 아님');
      const result=doc.getElementById('mdSendResult');result.replaceChildren();
      const link=el('a','전달 기록 보기','md-sent-record-link');link.href=M.recordLink(scope,record.id,'inbox');
      result.append(el('p','DEMO 수신함에 저장했습니다.'),link);focusAfterClose=link;link.focus();
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
    const decision=el('section',null,'md-layer md-layer-decision');decision.append(group,followup,notesWrap);
    const context=el('section',null,'md-layer md-layer-context');context.append(viewpointStatus,visitBox);
    const actionLayer=el('section',null,'md-layer md-layer-action');actionLayer.append(error,send,cancel);
    dialog.append(decision,context,actionLayer);
    const confirm=el('section',null,'md-discard-confirm');confirm.hidden=true;confirm.tabIndex=-1;confirm.setAttribute('role','alert');confirm.append(el('p','작성한 초안을 폐기할까요?'),action('계속 작성',()=>{confirm.hidden=true;notes.focus();}),action('초안 보관하고 닫기',()=>{syncReferences();try{records.draft(c.id,draft);dialog.close();}catch(_){error.textContent='초안 저장 실패 · 닫지 않았습니다.';}}),action('폐기하고 닫기',()=>{try{records.discard(c.id);dialog.close();}catch(_){error.textContent='초안 폐기 실패';}}));actionLayer.append(confirm);
    dialog.oncancel=event=>{event.preventDefault();close();};dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}};
    dialog.onclose=()=>{unsubscribe?.();try{state=readState();}catch(_){}if(focusAfterClose?.isConnected)focusAfterClose.focus();else if(trigger.isConnected)trigger.focus();else search.focus();};dialog.showModal();x.focus();
  }
  search.oninput=render;
  window.addEventListener('storage',event=>{if(event.key===records?.key)refresh();});render();
})(globalThis);

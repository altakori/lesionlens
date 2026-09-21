(async function(g){
  'use strict';
  const M=g.MD, doc=document, root=doc.getElementById('mdQueue');if(!root)return;
  const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=doc.getElementById('mdStatus'), list=doc.getElementById('mdList'), filter=doc.getElementById('mdFilter'), search=doc.getElementById('mdSearch');
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
    d.append(table,el('p','생성형 AI 소견 없음 · 진단/악성/전이/응급도는 판단하지 않습니다.'),el('p','별도 Radiomics 자료는 아래 보조 영역에서 확인합니다. 데이터셋 자동 매칭 없음.'));return d;}
  function render(){views.forEach(v=>v.close());views=[];list.replaceChildren();const items=M.queue(cases,evidence,state,filter.value,search.value);
    for(const c of items){const e=evidence[c.id], card=el('article',null,'md-case-card');card.dataset.caseId=c.id;
      card.append(el('h2',c.id),el('strong',c.synthetic?'DEMO ONLY · 합성 워크플로 시연 · 실제 CT/환자 없음':M.reason(e),'md-core-reason'));
      const chips=el('div',null,'md-reason-chips md-tags');
      if(e?.reasons.length)chips.append(el('span','모델 간 불일치','md-reason-chip md-tag'));
      if(e?.reasons.some(r=>r.smallAdditional))chips.append(el('span','작은 추가 후보','md-reason-chip md-tag'));
      const badge=el('span',state.reviews[c.id]?'검토 완료':'미검토','md-row-state');card.append(badge); // Reason text above already contains every tag.
      const secondary=el('div',null,'md-card-measurements md-metrics');
      for(const k of M.models){const m=e?.models[k]||c.models[k];secondary.append(el('p',m?`${M.labels[k]} · 3D 후보 ${m.componentCount}개 · 최대 ${Number((m.maxVolumeMl??Math.max(0,...m.componentVolumesMl)).toFixed(4))} mL · 전체 ${Number((m.totalVolumeMl??m.volumeMl).toFixed(4))} mL`:`${M.labels[k]} · 자료 없음`));}
      // Quantitative values remain available in the existing details table.
      const d=details(c,e);card.append(d);const viewer=el('div',null,'md-inline-viewer');viewer.hidden=true;let view;
      const open=action('CT 확대',()=>{if(viewer.hidden){d.open=false;viewer.hidden=false;view=MViewer();open.textContent='CT 접기';}else{view.close();viewer.hidden=true;open.textContent='CT 확대';}});
      function MViewer(){const v=g.MDViewer.mount(viewer,c);views.push(v);return v;}
      const review=action(state.reviews[c.id]?'다시 검토':'확인함',()=>{try{records.review(c.id,!state.reviews[c.id]);refresh();}catch(_){say('검토 저장 실패 · 상태 불변');}});
      review.setAttribute('aria-pressed',String(!!state.reviews[c.id]));
      const send=action('주치의에게 전송하기',()=>sendModal(c,e,send,()=>viewer.hidden?null:view));
      const actions=el('div',null,'md-case-actions');actions.append(open);const decisions=el('div',null,'md-decision-actions');decisions.append(el('span','검토 후'),review,send);card.append(actions);
      if(!M.eligible(c))d.append(el('p','실제 보내기 차단 · 승인된 환자–임상과 담당자 연결 없음 (병리학과 제외). 전송 창에서 참고 모델/메모 초안 확인 가능.'));
      for(const sent of Object.values(state.sends).filter(r=>r.case.id===c.id)){
        const link=el('a','보낸 기록 상세 · '+sent.time,'md-sent-record-link');link.href=M.recordLink(scope,sent.id);card.append(link);
      }
      card.append(viewer,decisions);list.append(card);
    }
    if(!items.length)list.append(el('p','조건에 맞는 사례 없음 · 전체 필터에서 다시 검토할 수 있습니다.'));
  }
  function sendModal(c,e,trigger,getViewer){const dialog=doc.getElementById('mdSendDialog');dialog.replaceChildren();
    const savedDraft=state.drafts[c.id];
    let draft=M.normalizeDraft(c,savedDraft);
    if(savedDraft === undefined)draft.viewpointChoice='auto';
    const baseline=JSON.stringify(draft);let busy=false, researchEnvelope=null, focusAfterClose=null;
    const error=el('p');error.setAttribute('role','alert');
    const persist=()=>{syncReferences();try{records.draft(c.id,draft);error.textContent='초안 로컬 저장됨 · 실제 전송 아님';}catch(_){error.textContent='초안 저장 실패 · 이 창의 입력을 유지합니다.';}};
    const close=()=>{if(busy)return;if(JSON.stringify(draft)!==baseline||draft.notes||draft.selected.length){confirm.hidden=false;confirm.focus();return;}dialog.close();};
    const x=action('×',close);x.title='전송 취소 및 닫기';x.setAttribute('aria-label','전송 취소 및 닫기');x.className='md-send-close';
    const legacyDemo=M.eligible(c);let allowed=legacyDemo;const title=el('h2','주치의에게 전송하기'+(allowed?' · DEMO ONLY':' · 보내기 미연결'));title.id='mdSendTitle';dialog.setAttribute('aria-labelledby',title.id);dialog.append(x,title,el('p',c.id),el('p',allowed?`수신: ${c.mapping.recipientId} · ${c.mapping.department} · 합성 환자 ${c.mapping.patientId}`:'수신 담당자 미연결 · 승인된 환자–임상과 주치의/담당 의료진 매핑 없음 · 병리학과 제외'),el('p','AI 분석 요약: 생성형 AI 소견 없음'),el('p',M.reason(e)));
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
      dialog.append(optLabel,demoRole);
    }
    if(e?.reasons.length){const candidates=el('ul',null,'md-send-candidates');for(const r of e.reasons)candidates.append(el('li',`${r.candidateId} · ${M.labels[r.model]} ↔ ${M.labels[r.otherModel]} · voxel ${r.voxel.join(', ')} · 절편 ${r.slice+1}`));dialog.append(candidates);}
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
    const notesLabel=el('label','MD 추가 소견·임상 메모 (로컬 초안 · 실제 전송 불가)'),notes=el('textarea');notes.value=draft.notes;notes.oninput=()=>{draft.notes=notes.value;persist();};notesLabel.append(notes);dialog.append(notesLabel,error);
    const send=action('✈',()=>{if(busy||!allowed||!validViewpoint()||!M.selection(c,draft.selected,draft.none))return;busy=true;send.disabled=true;try{
      const record=records.send(c,draft,e,researchEnvelope?'LOCAL_DEMO':'DEMO',researchEnvelope);
      dialog.close();refresh();say('LOCAL DEMO 저장 확인 완료 · 실제 병원 전송 아님');
      const result=doc.getElementById('mdSendResult');result.replaceChildren();
      const link=el('a','보낸 사례 상세 보기','md-sent-record-link');link.href=M.recordLink(scope,record.id);
      result.append(el('p',`${record.case.id} · 로컬 전달 저장됨`),link);focusAfterClose=link;link.focus();
    }catch(_){error.textContent='전송 저장 실패 또는 선택 오류 · 입력 유지 · 다시 시도하세요.';}finally{busy=false;syncReferences();}});send.disabled=!allowed;send.className='md-send-submit';send.title=allowed?'로컬 DEMO 수신함에 저장':'승인된 수신 담당자 미연결 · 보내기 불가';send.setAttribute('aria-label',allowed?'DEMO 보내기':'보내기 불가 · 수신 담당자 미연결');dialog.append(send,action('취소',close));
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
    const confirm=el('section',null,'md-discard-confirm');confirm.hidden=true;confirm.tabIndex=-1;confirm.setAttribute('role','alert');confirm.append(el('p','작성한 초안을 폐기할까요?'),action('계속 작성',()=>{confirm.hidden=true;notes.focus();}),action('초안 보관하고 닫기',()=>{syncReferences();try{records.draft(c.id,draft);dialog.close();}catch(_){error.textContent='초안 저장 실패 · 닫지 않았습니다.';}}),action('폐기하고 닫기',()=>{try{records.discard(c.id);dialog.close();}catch(_){error.textContent='초안 폐기 실패';}}));dialog.append(confirm);
    dialog.oncancel=event=>{event.preventDefault();close();};dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}};
    dialog.onclose=()=>{unsubscribe?.();try{state=readState();}catch(_){}if(focusAfterClose?.isConnected)focusAfterClose.focus();else if(trigger.isConnected)trigger.focus();else filter.focus();};dialog.showModal();notes.focus();
  }
  filter.onchange=search.oninput=render;
  window.addEventListener('storage',event=>{if(event.key===records?.key)refresh();});render();
})(globalThis);
